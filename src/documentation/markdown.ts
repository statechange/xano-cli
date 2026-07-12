// @ts-nocheck
// Ported from browser extension; loose-typed to match Xano runtime objects.

import { buildStepListFromXray } from "@statechange/xano-xray";
import type { DocInventory } from "./types.js";

export type ShowStepsOptions = {
  steps: boolean;
  inputs: boolean;
  outputs: boolean;
  internals: boolean;
};

export const DEFAULT_SHOW_STEPS: ShowStepsOptions = {
  steps: true,
  inputs: true,
  outputs: true,
  internals: true,
};

interface DocCtx {
  xs: Record<string, any[]>;
  inventory: DocInventory;
  instanceHost: string;
}

let ctx: DocCtx | null = null;

let _showSteps: ShowStepsOptions = { ...DEFAULT_SHOW_STEPS };

function getXsItem(type: string, name: string) {
  if (!ctx?.xs[type]) return undefined;
  return ctx.xs[type].find((item: any) => item.name === name);
}

function getInv(collection: string, id: number) {
  const list = (ctx!.inventory as any)[collection];
  if (!Array.isArray(list)) return undefined;
  return list.find((item: any) => item.id === id);
}

function getUrl(inv: DocInventory) {
  const w = inv.workspace;
  if (!w?.id) return `https://${ctx!.instanceHost}/`;
  const bid = w.branch?.id ?? inv.branch?.id ?? 0;
  return `https://${ctx!.instanceHost}/workspace/${w.id}-${bid}/`;
}

function withDocCtx<T>(
  xs: Record<string, any[]>,
  inventory: DocInventory,
  instanceHost: string,
  showSteps: ShowStepsOptions,
  fn: () => T
): T {
  ctx = { xs, inventory, instanceHost };
  _showSteps = { ...showSteps };
  try {
    return fn();
  } finally {
    ctx = null;
  }
}

function makeFiltersMarkdown(filters, level = 1, skipHeader = false) {
  const sections = [];
  if (!skipHeader)
    sections.push(
      `${"  ".repeat(level)}- **Filters: ${filters?.length || 0}**`,
    );
  for (const filter of filters) {
    let xs = getXsItem("pipe", filter.name);
    if (!xs) {
      xs = getXsItem("filter", filter.name);
      if (!xs) {
        console.warn("Aborting because no xs for filter", filter.name);
        continue;
      }
    }
    // console.log("filter", filter);
    // console.log("xs", xs);
    sections.push(`${"  ".repeat(level)}- ${xs.display}`);
    if (xs.arg?.length) {
      for (let argIndex in xs.arg) {
        const arg = xs.arg[argIndex] as {
          name: string;
          default: any;
          description: string;
          hint: string;
          type: string;
        };
        const tag = filter.arg[argIndex]?.tag || "default";
        const value = filter.arg[argIndex]?.value || arg.default;
        let val;
        if (tag.startsWith("const")) {
          if (value === "") val = "*<blank>*";
          else val = value;
        } else {
          val = `\`${tag}:${value}\``;
        }
        sections.push(`${"  ".repeat(level + 1)}- ${arg.name}: ${val}`);
        if (filter.arg[argIndex]?.filters?.length) {
          sections.push(
            ...makeFiltersMarkdown(filter.arg[argIndex].filters, level + 2),
          );
        }
      }
    }
  }
  return sections;
}

function makeExpressionMarkdown(expression, level = 1) {
  if (!expression) return [];
  const sections = [];
  let started = false;
  if (expression?.length)
    for (const expr of expression) {
      if (expr.type === "statement") {
        sections.push(
          `${"  ".repeat(level)}- ${
            started ? (expr.or ? "OR " : "AND ") : " "
          }\`${expr.statement.left.tag}:${expr.statement.left.operand}\` ${
            expr.statement.op
          } \`${expr.statement.right.tag}:${expr.statement.right.operand}\``,
        );
        if (expr.statement.left.filters?.length) {
          sections.push("  ".repeat(level + 1) + "- filters on left operand:");
          sections.push(
            ...makeFiltersMarkdown(expr.statement.left.filters, level + 2),
          );
        }
        if (expr.statement.right.filters?.length) {
          sections.push("  ".repeat(level + 1) + "- filters on right operand:");
          sections.push(
            ...makeFiltersMarkdown(expr.statement.right.filters, level + 2),
          );
        }
      }
      if (expr.type === "group") {
        if (level > 1)
          sections.push(
            ...makeExpressionMarkdown(expr.group.expression, level + 1),
          );
      }
      started = true;
    }
  return sections;
}

function makeInputsMarkdown(step, func = undefined) {
  if (!_showSteps.internals) return [];
  if (!step.raw.input?.length) return [];
  const sections = ["  Inputs: "];
  step.raw.input.forEach((input) => {
    if (input.ignore) return;
    sections.push(`  - ${input.name}: \`${input.tag}:${input.value}\``);
    if (input.filters?.length) {
      sections.push(`    - filters:`);
      sections.push(...makeFiltersMarkdown(input.filters, 2));
    }
  });

  return sections;
}

function makeValueMarkdown(step, func = undefined) {
  if (!_showSteps.internals) return [];
  if (!step.raw?.context) {
    console.warn("Aborting because no context for step", step.name, step.raw);
    return [];
  }
  if (!step.raw?.context?.value) return [];
  // const sections = ["  Value: "];
  const sections = [];
  if (typeof step.raw.context.value === "object") {
    sections.push(
      `  - ${step.raw.context.value.name || "value"}: \`${
        step.raw.context.value.tag
          ? step.raw.context.value.tag + ":" + step.raw.context.value.value
          : step.raw.context.value.value
      }\``,
    );
  } else {
    sections.push(`  - value: \`${step.raw.context.value}\``);
  }
  if (step.raw.context.filters?.length) {
    sections.push(`    - filters:`);
    sections.push(...makeFiltersMarkdown(step.raw.context.filters, 2));
  }

  return sections;
}

function makeStepMarkdown(step, inventory) {
  const item = getXsItem("statement", step.name);
  if (!item) {
    console.warn("Aborting because no xs for step", step.name);
    return [];
  }
  const sections = [];
  if (step.disabled || step.parentDisabled) {
    sections.push(
      `##### *${step.position2} ${step.description || item.display} (disabled)*`,
    );
    return sections;
  }
  const as = step.as || step.raw.context?.as || "";
  const asPhrase = as ? ` as \`var:${as}\`` : "";
  if (item.name === "mvp:function") {
    const functionId = step.raw.context.function.id;
    const func = getInv("functions", functionId);
    // sections.push(`##### ${step.position2} [deleted function ${functionId}]`);
    if (func) {
      sections.push(
        `##### ${step.position2} ${func.description || func.name}${asPhrase}`,
      );
    } else {
      sections.push(
        `##### ${step.position2} [deleted function #${functionId}]${asPhrase}`,
      );
    }
    sections.push(...makeInputsMarkdown(step, func));
  } else if (item.name === "mvp:dbo_view") {
    const dboId = step.raw.context.dbo.id;
    const dbo = getInv("dbos", dboId);
    if (!dbo) {
      sections.push(
        `##### ${step.position2} ${
          step.description || item.display + " from"
        } [deleted table #${dboId}]${asPhrase}`,
      );
    } else {
      sections.push(
        `##### ${step.position2} ${
          step.description || item.display + " from"
        } **${dbo.description || dbo.name}**${asPhrase}`,
      );
    }
    if (_showSteps.internals) {
      //Look at the query expression
      //Look at externals

      if (step.raw.context.search?.expression?.length) {
        sections.push(`  - Custom Filters:`);
        sections.push(
          ...makeExpressionMarkdown(step.raw.context.search.expression, 2),
        );
      }
      if (step.raw.context.simpleExternal?.offset?.value) {
        sections.push(
          `  - offset \`${step.raw.context.simpleExternal.offset.tag}:${step.raw.context.simpleExternal.offset.value}\``,
        );
        if (step.raw.context.simpleExternal.offset.filters?.length)
          sections.push(
            ...makeFiltersMarkdown(
              step.raw.context.simpleExternal.offset.filters,
              2,
            ),
          );
      }
      if (step.raw.context.simpleExternal?.page?.value) {
        sections.push(
          `  - page \`${step.raw.context.simpleExternal.page.tag}:${step.raw.context.simpleExternal.page.value}\``,
        );
        if (step.raw.context.simpleExternal.page.filters?.length)
          sections.push(
            ...makeFiltersMarkdown(
              step.raw.context.simpleExternal.page.filters,
              2,
            ),
          );
      }
      if (step.raw.context.simpleExternal?.per_page?.value) {
        sections.push(
          `  - per_page \`${step.raw.context.simpleExternal.per_page.tag}:${step.raw.context.simpleExternal.per_page.value}\``,
        );
        if (step.raw.context.simpleExternal.per_page.filters?.length)
          sections.push(
            ...makeFiltersMarkdown(
              step.raw.context.simpleExternal.per_page.filters,
              2,
            ),
          );
      }
      if (step.raw.context.simpleExternal?.search?.value) {
        sections.push(
          `  - search \`${step.raw.context.simpleExternal.search.tag}:${step.raw.context.simpleExternal.search.value}\``,
        );
        if (step.raw.context.simpleExternal.search.filters?.length)
          sections.push(
            ...makeFiltersMarkdown(
              step.raw.context.simpleExternal.search.filters,
              2,
            ),
          );
      }
      if (step.raw.context.simpleExternal?.sort?.value) {
        sections.push(
          `  - sort \`${step.raw.context.simpleExternal.sort.tag}:${step.raw.context.simpleExternal.sort.value}\``,
        );
        if (step.raw.context.simpleExternal.sort.filters?.length)
          sections.push(
            ...makeFiltersMarkdown(
              step.raw.context.simpleExternal.sort.filters,
              2,
            ),
          );
      }

      const returnType = step.raw.context.return?.type || "list";
      if (!returnType) console.warn("Skipping return type", step);
      let sort;
      switch (returnType) {
        case "list":
          const paging = step.raw.context.return?.list?.paging?.enabled;
          const withMetadata = step.raw.context.return?.list?.paging?.metadata;
          const withTotals = step.raw.context.return?.list?.paging?.totals;
          sections.push(
            `  - as ${paging ? "paginated " : `raw `}list${
              paging
                ? withMetadata
                  ? " with metadata"
                  : " without metadata"
                : ""
            }${paging && withMetadata && withTotals ? " and totals" : ""}`,
          );
          sort = step.raw.context.return?.list?.sort;
          if (sort?.length) {
            for (const s of sort) {
              sections.push(
                `  - sorted by \`${s.sortBy}\` ${
                  s.orderBy === "asc" ? "ascending" : "descending"
                }`,
              );
            }
          }
          break;
        case "single":
          const single = step.raw.context.return?.single;
          sections.push(`  - as single row (no array)`);
          sort = step.raw.context.return?.single?.sort;
          if (sort?.length) {
            for (const s of sort) {
              sections.push(
                `  - sorted by \`${s.sortBy}\` ${
                  s.orderBy === "asc" ? "ascending" : "descending"
                }`,
              );
            }
          }
          break;
        case "stream":
          sections.push(`  - as stream`);
          const spaging = step.raw.context.return?.stream?.paging?.enabled;
          const swithMetadata =
            step.raw.context.return?.stream?.paging.metadata;
          const swithTotals = step.raw.context.return?.stream?.paging?.totals;
          sections.push(
            `  - as ${spaging ? "paginated " : `raw `}list${
              spaging
                ? swithMetadata
                  ? " with metadata"
                  : "without metadata"
                : ""
            }${spaging && swithMetadata && swithTotals ? " and totals" : ""}`,
          );
          sort = step.raw.context.return?.stream?.sort;
          if (sort?.length) {
            for (const s of sort) {
              sections.push(
                `  - sorted by \`${s.sortBy}\` ${
                  s.orderBy === "asc" ? "ascending" : "descending"
                }`,
              );
            }
          }

          break;
        case "aggregate":
          // sections.push(`  - as aggregate`);
          const groups = step.raw.context.return?.aggregate?.group;
          if (groups?.length) {
            for (const g of groups) {
              if (g.name !== g.as) {
                sections.push(`  - grouped by ${g.name} as \`${g.as}\``);
              } else {
                sections.push(`  - grouped by \`${g.name}\``);
              }
            }
          }
          const evals = step.raw.context.return?.aggregate?.eval;
          if (evals?.length) {
            for (const e of evals) {
              const f = e.filters.filter((f) => !f.disabled).shift();
              const aggName = f.name;
              sections.push(`  - ${aggName} of ${e.name} as \`${e.as}\``);
            }
          }
          sort = step.raw.context.return.aggregate.sort;
          if (sort?.length) {
            for (const s of sort) {
              sections.push(`  - sorted by \`${s.sortBy}\` ${s.orderBy}`);
            }
          }
          break;
        case "count":
          sections.push(`  - as count`);
          break;
        case "exists":
          sections.push(`  - as boolean (true if at least one record exists)`);
          break;
      }
    }
  } else if (
    item.name === "mvp:dbo_add" ||
    item.name === "mvp:dbo_editby" ||
    item.name === "mvp:dbo_addoreditby" ||
    item.name === "mvp:dbo_patch"
  ) {
    const dboId = step.raw.context.dbo?.id;
    const dbo = getInv("dbos", dboId);
    if (!dbo) {
      sections.push(
        `##### ${step.position2} ${
          step.description || item.display + " in"
        } [deleted table]${asPhrase}`,
      );
    } else {
      sections.push(
        `##### ${step.position2} ${
          step.description || item.display + " in"
        } **${dbo.description || dbo.name}**${asPhrase}`,
      );
    }
    sections.push(...makeInputsMarkdown(step));
  } else if (item.name.includes("mvp:dbo_")) {
    const dboId = step.raw.context.dbo?.id;
    const dbo = getInv("dbos", dboId);
    if (!dbo) {
      sections.push(
        `##### ${step.position2} ${
          step.description || item.display
        } [deleted table]${asPhrase}`,
      );
    } else {
      sections.push(
        `##### ${step.position2} ${step.description || item.display} **${
          dbo.description || dbo.name
        }**${asPhrase}`,
      );
    }
    sections.push(...makeInputsMarkdown(step));
  } else if (item.name === "mvp:foreach") {
    const list = step.raw.context.list;
    sections.push(
      `##### ${step.position2} ${step.description || item.display} \`${
        list.tag
      }:${list.value}\`${asPhrase}`,
    );
  } else if (item.name === "mvp:conditional_elif") {
    sections.push(
      `##### ${step.position2} ${step.description || item.display} - else if:`,
    );
    sections.push(...makeExpressionMarkdown(step.raw.context.expr.expression));
  } else if (item.name === "mvp:conditional") {
    sections.push(
      `##### ${step.position2} ${step.description || item.display} - if:`,
    );
    sections.push(...makeExpressionMarkdown(step.raw.context.expr.expression));
  } else if (item.name === "mvp:while") {
    sections.push(
      `##### ${step.position2} ${step.description || item.display} - condition:`,
    );
    sections.push(...makeExpressionMarkdown(step.raw.context.expr.expression));
  } else if (item.name === "mvp:precondition") {
    sections.push(
      `##### ${step.position2} ${step.description || item.display} continue if:`,
    );
    sections.push(...makeExpressionMarkdown(step.raw.context.expr.expression));
  } else if (item.name === "mvp:update_var") {
    sections.push(
      `##### ${step.position2} ${step.description || item.display} \`var:${
        step.raw.context.name
      }\``,
      `  - set to \`${step.raw.context.tag}:${step.raw.context.value}\`${
        step.raw.context.filters?.length ? " with filters:" : ""
      }`,
    );
    if (step.raw.context.filters?.length) {
      sections.push("  - with filters:");
      sections.push(...makeFiltersMarkdown(step.raw.context.filters, 2));
    }
  } else if (item.name === "mvp:array_push") {
    sections.push(
      `##### ${step.position2} ${step.description || item.display} \`var:${
        step.raw.context.value
      }\``,
      `  - push \`${step.raw.context.tag}:${step.raw.context.value}\` 
      }`,
    );
    if (step.raw.context.filters?.length)
      sections.push(...makeFiltersMarkdown(step.raw.context.filters, 2));
  } else if (item.name === "mvp:die") {
    sections.push(
      `##### ${step.position2} ${step.description || item.display}${asPhrase}`,
      `  - display \`${step.raw.context.tag}:${step.raw.context.value}\``,
    );
    if (step.raw.context.filters?.length)
      sections.push(...makeFiltersMarkdown(step.raw.context.filters, 2));
  } else if (item.name === "mvp:set_var") {
    sections.push(
      `##### ${step.position2} ${step.description || item.display}${asPhrase}`,
    );
    sections.push(
      `  From: \`${step.raw.context.tag}:${step.raw.context.value}\``,
    );
    if (step.raw.context?.filters?.length) {
      sections.push("");
      sections.push(`  Output filtered by:`);
      const filterSections = makeFiltersMarkdown(
        step.raw.context.filters,
        1,
        true,
      );
      sections.push(...filterSections);
    }
  } else {
    sections.push(
      `##### ${step.position2} ${step.description || item.display}${asPhrase}`,
    );
    sections.push(...makeInputsMarkdown(step));
    sections.push(...makeValueMarkdown(step));
  }
  if (step.raw.output?.filters?.length) {
    sections.push("");
    sections.push(`  Output filtered by:`);
    const filterSections = makeFiltersMarkdown(
      step.raw.output.filters,
      1,
      true,
    );
    sections.push(...filterSections);
  }

  return sections;
}
function makeFunctionStackMarkdown(stackObj, inventory) {
  const sections = [];
  const steps = buildStepListFromXray(stackObj);
  if (stackObj.tag?.length) {
    const tags = [];
    stackObj.tag.forEach(({ tag }) => {
      tags.push(`**${tag}**`);
    });

    sections.push(``);
    sections.push(`Tags: ${tags.join(", ")}`);
  }
  if (_showSteps.inputs && stackObj.input?.length) {
    sections.push(``);
    sections.push(`#### Inputs: ${stackObj.input?.length || 0}`);
    sections.push(``);
    if (stackObj.input?.length)
      stackObj.input?.forEach((input) => {
        const inputXS = getXsItem("schema", input.type);
        sections.push(
          `##### \`${input.name}\` (${input.type})${
            input.style?.type ? " " + input.style.type : ""
          } ${input.required ? "(required)" : "(optional)"}`,
        );

        if (input.description) sections.push(`- ${input.description}`);
        if (input.sensitive) sections.push("- sensitive");
        if (input.nullable) sections.push(`- nullable`);
        if (input.access !== "public")
          sections.push(`- access: ${input.access}`);
        else sections.push(`- not nullable`);
        if (input.default !== "")
          sections.push(`- (default: ${input.default})`);
        const l = [];
        if (input.list?.min) l.push(`min: ${input.list.min}`);
        if (input.list?.max) l.push(`max: ${input.list.max}`);
        if (l.length) sections.push("- " + l.join(", "));
        if (input.methods?.length) {
          for (const method of input.methods) {
            const methodXS = inputXS?.methods?.find(
              ({ name }: { name: string }) => name === method.name,
            );
            if (!methodXS) {
              if (method.name == "@") {
                const arg0 = method.arg[0];
                const [key, value] = arg0.split("=");
                // console.log("key", key, "value", value);
                const dbo = inventory.dbos.find(
                  (dbo) => dbo.id === parseInt(value),
                );
                // console.log("inventory", inventory);
                // console.log("dbo", dbo);
                if (!dbo) {
                  sections.push(`- associated with deleted table #${value}`);
                } else {
                  sections.push(
                    `- associated with table \`${dbo.name}\` #${dbo.id}`,
                  );
                }
              } else {
                console.warn("Skipping method", method);
              }
              continue;
            }
            // console.log("methodXS", methodXS);
            sections.push(
              "- " +
                methodXS.name +
                (methodXS.arg?.length
                  ? ": " +
                    methodXS.arg
                      .map(
                        (arg, index) =>
                          arg.name +
                          ": " +
                          method.arg[index] +
                          (method.arg.disabled ? " (disabled)" : ""),
                      )
                      .join(", ")
                  : "") +
                (method.disabled ? " (disabled)" : ""),
            );
          }
        }
      });
  }
  if (_showSteps.steps) {
    sections.push(``);
    sections.push(`#### Steps: ${steps?.length || 0}`);
    sections.push(``);
    const level = 0;
    steps.forEach((step, index) => {
      const previousPosition =
        index > 0 ? steps[index - 1].position : undefined;
      if (previousPosition) {
        const position = step.position;
        // console.log("Comparing", position, "to", previousPosition);
        const currentLevel = step.position?.split(".") || [];
        const currentBase = currentLevel
          .slice(0, currentLevel.length - 1)
          .join(".");
        const previousLevel = previousPosition?.split(".") || [];
        const previousBase = previousLevel
          .slice(0, previousLevel.length - 1)
          .join(".");
        if (currentBase !== previousBase) {
          // console.log(
          //   "Chainging step base from",
          //   previousBase,
          //   "to",
          //   currentBase
          // );
          if (currentBase.endsWith(".if")) {
            sections.push(`**then**`);
          } else if (currentBase.endsWith(".else")) {
            sections.push(`**else**`);
          }
          //check whether this step is in an if or else
          // console.log("step", step.position, step.position2);
        }
      }
      sections.push(...makeStepMarkdown(step, inventory));
    });
  }
  if (_showSteps.outputs && stackObj.result?.length) {
    sections.push(`#### Outputs: ${stackObj.result?.length || 0}`);
    stackObj.result?.forEach((output) => {
      sections.push(
        `- ${output.name || "self"}: \`${
          _showSteps
            ? output.value
              ? output.tag + ":" + output.value
              : "N/A"
            : ""
        }\``,
      );
      if (output.filters?.length) {
        sections.push(`  - filters:`);
        sections.push(...makeFiltersMarkdown(output.filters));
      }
    });
  }
  return sections;
}
function makeWorkspaceOverviewMarkdown(inventory) {
  const { workspace } = inventory;
  if (!workspace) {
    console.warn("No workspace");
    return [];
  }
  const url = getUrl(inventory);
  const { name } = workspace;
  const sections = [];
  sections.push(`# ${name}`);
  sections.push(`#${workspace.id} [[open]](${url})`);
  sections.push(`${workspace.description}`);
  if (workspace.env) {
    sections.push(``);

    sections.push(`#### [Environment Variables](${url}settings)`);
    sections.push(``);

    workspace.env?.forEach((env) => {
      sections.push(`- ${env.name} `);
    });
  }
  if (workspace.datasources) {
    sections.push(``);

    sections.push("#### Data Sources");
    sections.push(``);

    workspace.datasources?.forEach((ds) => {
      sections.push(`- ${ds.label} `);
    });
  }
  return sections;
}
function makeAppOverviewMarkdown(app, inventory) {
  const url = getUrl(inventory);

  const { name } = app;
  const sections = [];
  sections.push(``);

  sections.push(`## ${name} `);
  sections.push(``);

  sections.push(
    `#${app.id} Canonical ID: ${app.canonical} [[open]](${url}api/${app.id})`,
  );
  sections.push(``);

  if (app.description) {
    sections.push("");
    sections.push(`${app.description}`);
  }
  return sections;
}

function makeMiddlewareSectionMarkdown(
  preMiddleWare,
  postMiddleWare,
  inventory,
) {
  const sections = [];
  if (preMiddleWare?.length) {
    sections.push(``);
    sections.push("#### Pre Middleware");
    sections.push(``);
    for (const m of preMiddleWare) {
      const mItem = inventory.middleware.find(
        ({ id }) => id == m.context.middleware?.id,
      );
      if (!mItem) continue;
      sections.push(
        `- [${mItem.description || mItem.name}](${getUrl(
          inventory,
        )}middleware/${mItem.id})`,
      );
    }
  }
  if (postMiddleWare?.length) {
    sections.push(``);
    sections.push("#### Post Middleware");
    sections.push(``);
    for (const m of postMiddleWare) {
      const mItem = inventory.middleware.find(
        ({ id }) => id == m.context.middleware.id,
      );
      if (!mItem) continue;
      sections.push(
        `- [${mItem.description || mItem.name}](${getUrl(
          inventory,
        )}middleware/${mItem.id})`,
      );
    }
  }

  return sections;
}
function makeQueryAPIMarkdown(query, inventory) {
  const url = getUrl(inventory);
  const sections = [];
  sections.push(``);

  sections.push(`### /${query.name}`);
  sections.push(``);

  sections.push(
    `#${query.id} [[open]](${url}api/${query.app?.id}/query/${query.id})`,
  );
  sections.push(``);
  const canonical = inventory.apps.find(({ id }) => id == query.app?.id)?.canonical;
  const queryUrl = `https://${ctx!.instanceHost}/${canonical}/${query.name}`;
  sections.push(`URL: [${queryUrl}](${queryUrl})`);
  if (queryUrl.includes("{")) {
    sections.push("(**Note: Curly braces indicate dynamic path variables**)");
  }
  sections.push(``);
  const curl = makeCurlCommand(query, inventory, ctx!.instanceHost);
  if (curl) {
    sections.push(`#### Curl Command:
\`\`\`
${curl}
\`\`\`
`);
  }
  if (query.description) sections.push(`${query.description}`);
  const app = inventory.apps.find(({ id }) => id == query.app?.id);
  let preMiddleWare;
  if (query.middleware.pre_customize) {
    preMiddleWare = query.middleware.pre;
  } else if (app?.middleware?.pre_customize) {
    preMiddleWare = app.middleware.pre;
  } else {
    preMiddleWare = inventory.workspace?.middleware?.query_pre;
  }
  let postMiddleWare;
  if (query.middleware.post_customize) {
    postMiddleWare = query.middleware.post;
  } else if (app?.middleware?.post_customize) {
    postMiddleWare = app.middleware.post;
  } else {
    postMiddleWare = inventory.workspace?.middleware?.query_post;
  }

  if (preMiddleWare?.length || postMiddleWare?.length)
    sections.push(
      ...makeMiddlewareSectionMarkdown(
        preMiddleWare,
        postMiddleWare,
        inventory,
      ),
    );
  sections.push(...makeFunctionStackMarkdown(query, inventory));
  return sections;
}
export function makeQueryAPIDocumentation(
  api: any,
  inventory: DocInventory,
  showSteps: ShowStepsOptions,
  instanceHost: string,
  xs: Record<string, any[]>
) {
  return withDocCtx(xs, inventory, instanceHost, showSteps, () => {
    const sections: string[] = [];
    sections.push(...makeQueryAPIMarkdown(api, inventory));
    return sections.join("\n");
  });
}

function makeTasksOverviewMarkdown(inventory) {
  const sections = [];
  sections.push("## Tasks");
  inventory.tasks?.forEach((task) => {
    sections.push(...makeTaskMarkdown(task, inventory));
  });
  return sections;
}
function makeTaskMarkdown(task, inventory) {
  const sections = [];
  sections.push(``);
  sections.push(`### ${task.name}`);
  sections.push(``);
  sections.push(`#${task.id} [[open]](${getUrl(inventory)}task/${task.id})`);
  sections.push(``);
  if (task.description) sections.push(`${task.description}`);
  if (task.schedule?.length) {
    sections.push("#### Schedule");
    task.schedule.forEach((schedule) => {
      if (schedule.repeat) {
        sections.push(
          `- ${schedule.repeat.enabled ? "" : "(disabled) "}every ${
            schedule.repeat.freq
          } seconds starting on ${new Date(
            schedule.starts_on,
          ).toLocaleString()} ${
            schedule.repeat.ends.on
              ? ` until ${new Date(schedule.repeat.ends.on).toLocaleString()}`
              : ""
          }`,
        );
      } else {
        sections.push(
          `- ${schedule.cron.enabled ? "" : "(disabled) "} once on: ${new Date(
            schedule.starts_on,
          ).toLocaleString()}`,
        );
      }
    });
  }
  let preMiddleWare;
  let preMiddleWareSource;
  if (task.middleware.pre_customize) {
    preMiddleWare = task.middleware.pre;
    preMiddleWareSource = "endpoint";
  } else {
    preMiddleWare = inventory.workspace?.middleware?.task_pre;
    preMiddleWareSource = "workspace";
  }
  let postMiddleWare;
  let postMiddleWareSource;
  if (task.middleware.post_customize) {
    postMiddleWare = task.middleware.post;
    postMiddleWareSource = "endpoint";
  } else {
    postMiddleWare = inventory.workspace?.middleware?.task_post;
    postMiddleWareSource = "workspace";
  }

  if (preMiddleWare?.length || postMiddleWare?.length)
    sections.push(
      ...makeMiddlewareSectionMarkdown(
        preMiddleWare,
        postMiddleWare,
        inventory,
      ),
    );
  sections.push(...makeFunctionStackMarkdown(task, inventory));
  return sections;
}

export function makeTaskDocumentation(
  task: any,
  inventory: DocInventory,
  showSteps: ShowStepsOptions,
  instanceHost: string,
  xs: Record<string, any[]>
) {
  return withDocCtx(xs, inventory, instanceHost, showSteps, () => {
    const sections: string[] = [];
    sections.push(...makeTaskMarkdown(task, inventory));
    return sections.join("\n");
  });
}

function makeTriggersOverviewMarkdown(inventory) {
  const sections = [];
  sections.push(``);

  sections.push("## Triggers");
  sections.push(``);

  inventory.triggers?.forEach((trigger) => {
    sections.push(...makeTriggerMarkdown(trigger, inventory));
  });
  return sections;
}

export function makeTriggerMarkdown(trigger, inventory) {
  const sections = [];
  sections.push(``);

  sections.push(`### ${trigger.name}`);
  sections.push(``);

  sections.push(
    `#${trigger.id} [[open]](${getUrl(inventory)}trigger/${trigger.id})`,
  );
  sections.push(``);

  if (trigger.description) sections.push(`${trigger.description}`);
  sections.push(...makeFunctionStackMarkdown(trigger, inventory));
  return sections;
}

export function makeTriggerDocumentation(
  trigger: any,
  inventory: DocInventory,
  showSteps: ShowStepsOptions,
  instanceHost: string,
  xs: Record<string, any[]>
) {
  return withDocCtx(xs, inventory, instanceHost, showSteps, () => {
    const sections: string[] = [];
    sections.push(...makeTriggerMarkdown(trigger, inventory));
    return sections.join("\n");
  });
}

function makeFunctionOverviewMarkdown(inventory) {
  const sections = [];
  sections.push(``);

  sections.push("## Functions");

  inventory.functions?.forEach((func) => {
    sections.push(...makeFunctionMarkdown(func, inventory));
  });
  return sections;
}
const _references = undefined;
export function makeFunctionMarkdown(func, inventory) {
  //get references
  // console.log("makeFunctionMarkdown starting", func, inventory);
  let references = [];
  if (_references) {
    references = _references[func.id] || [];
  } else {
    //now get my references to this function from other functions, queries, tasks and triggers
    inventory.functions?.forEach((f) => {
      const steps = buildStepListFromXray(f);
      steps.forEach((step) => {
        if (step.raw.context?.function?.id === func.id) {
          references.push({ type: "function", id: f.id, name: f.name });
        }
      });
    });
    inventory.queries?.forEach((q) => {
      const steps = buildStepListFromXray(q);
      steps.forEach((step) => {
        if (step.raw.context?.function?.id === func.id) {
          references.push({
            type: "query",
            id: q.id,
            name: q.name,
            appId: q.app?.id,
          });
        }
      });
    });
    // console.log("got past queries");
    inventory.tasks?.forEach((t) => {
      const steps = buildStepListFromXray(t);
      steps.forEach((step) => {
        if (step.raw.context?.function?.id === func.id) {
          references.push({ type: "task", id: t.id, name: t.name });
        }
      });
    });
    // console.log("got past tasks");
    inventory.triggers?.forEach((t) => {
      const steps = buildStepListFromXray(t);
      steps.forEach((step) => {
        if (step.raw.context?.function?.id === func.id) {
          references.push({ type: "trigger", id: t.id, name: t.name });
        }
      });
    });
    // console.log("got past triggers");
    inventory.tools?.forEach((t: any) => {
      if (t.toolset?.id === func.toolset?.id) {
        references.push({
          type: "tool",
          id: t.id,
          name: t.name,
          toolsetId: t.toolset?.id,
        });
      }
    });
    // console.log("got past tools");
  }
  const sections = [];
  sections.push(``);
  sections.push(`### ${func.name}`);
  sections.push(``);
  sections.push(
    `#${func.id} [[open]](${getUrl(inventory)}function/${func.id})`,
  );
  if (func.description) sections.push(`${func.description}`);
  if (references.length) {
    sections.push("#### References");
    if (references?.length)
      references.forEach((ref) => {
        sections.push(
          `- ${ref.type}: ${ref.name} [[open]](${
            ref.type === "query"
              ? getUrl(inventory) + "api/" + ref.appId + "/query"
              : ref.type === "tool"
                ? getUrl(inventory) + "toolset/" + (ref as any).toolsetId + "/tool"
                : getUrl(inventory) + ref.type
          }/${ref.id})`,
        );
      });
  }
  // console.log("got past references");
  let preMiddleWare;
  let postMiddleWare;
  let preMiddleWareSource;
  let postMiddleWareSource;
  if (func.middleware.pre_customize) {
    preMiddleWare = func.middleware.pre;
    preMiddleWareSource = "endpoint";
  } else {
    preMiddleWare = inventory.workspace?.middleware?.function_pre;
    preMiddleWareSource = "workspace";
  }
  if (func.middleware.post_customize) {
    postMiddleWare = func.middleware.post;
    postMiddleWareSource = "endpoint";
  } else {
    postMiddleWare = inventory.workspace?.middleware?.function_post;
    postMiddleWareSource = "workspace";
  }

  if (preMiddleWare?.length || postMiddleWare?.length)
    sections.push(
      ...makeMiddlewareSectionMarkdown(
        preMiddleWare,
        postMiddleWare,
        inventory,
      ),
    );
  sections.push(...makeFunctionStackMarkdown(func, inventory));
  return sections;
}

export function makeToolsetMarkdown(toolset, inventory) {
  const sections = [];
  sections.push(``);
  sections.push(`### ${toolset.name}`);
  sections.push(``);
  sections.push(
    `#${toolset.id} [[open]](${getUrl(inventory)}toolset/${toolset.id})`,
  );
  if (toolset.description) sections.push(`${toolset.description}`);
  return sections;
}

export function makeToolMarkdown(tool, inventory) {
  const sections = [];
  sections.push(``);
  sections.push(`### ${tool.name}`);
  sections.push(``);
  sections.push(
    `#${tool.id} [[open]](${getUrl(inventory)}toolset/${tool.toolset.id}/tool/${
      tool.id
    })`,
  );
  let preMiddleWare;
  let postMiddleWare;
  let preMiddleWareSource;
  let postMiddleWareSource;
  if (tool.middleware?.pre_customize) {
    preMiddleWare = tool.middleware.pre;
    preMiddleWareSource = "endpoint";
  } else {
    preMiddleWare = inventory.workspace?.middleware?.function_pre;
    preMiddleWareSource = "workspace";
  }
  if (tool.middleware?.post_customize) {
    postMiddleWare = tool.middleware.post;
    postMiddleWareSource = "endpoint";
  } else {
    postMiddleWare = inventory.workspace?.middleware?.function_post;
    postMiddleWareSource = "workspace";
  }

  if (preMiddleWare?.length || postMiddleWare?.length)
    sections.push(
      ...makeMiddlewareSectionMarkdown(
        preMiddleWare,
        postMiddleWare,
        inventory,
      ),
    );
  sections.push(...makeFunctionStackMarkdown(tool, inventory));
  return sections;
}

export function makeFunctionDocumentation(
  func: any,
  inventory: DocInventory,
  showSteps: ShowStepsOptions,
  instanceHost: string,
  xs: Record<string, any[]>
) {
  return withDocCtx(xs, inventory, instanceHost, showSteps, () => {
    const sections: string[] = [];
    sections.push(...makeFunctionMarkdown(func, inventory));
    return sections.join("\n");
  });
}

export function makeToolDocumentation(
  tool: any,
  inventory: DocInventory,
  showSteps: ShowStepsOptions,
  instanceHost: string,
  xs: Record<string, any[]>
) {
  return withDocCtx(xs, inventory, instanceHost, showSteps, () => {
    const sections: string[] = [];
    sections.push(...makeToolMarkdown(tool, inventory));
    return sections.join("\n");
  });
}
export function makeMiddlewareDocumentation(
  mw: any,
  inventory: DocInventory,
  showSteps: ShowStepsOptions,
  instanceHost: string,
  xs: Record<string, any[]>
) {
  return withDocCtx(xs, inventory, instanceHost, showSteps, () => {
    const sections: string[] = [];
    sections.push(...makeMiddlewareMarkdown(mw, inventory));
    return sections.join("\n");
  });
}

function makeMiddlewareMarkdown(mw, inventory) {
  //get references
  let references = [];

  //now get my references to this function from other functions, queries, tasks and triggers
  inventory.functions?.forEach((f) => {
    if (f.middleware?.pre_customize) {
      if (f.middleware.pre?.some((m) => m.id === mw.id)) {
        references.push({ type: "function", id: f.id, name: f.name });
      } else if (inventory.workspace?.middleware?.function_pre) {
        if (
          inventory.workspace?.middleware?.function_pre.some(
            (m) => m.id === mw.id,
          )
        ) {
          references.push({ type: "function", id: f.id, name: f.name });
        }
      }
      if (f.middleware?.post_customize) {
        if (f.middleware.post?.some((m) => m.id === mw.id)) {
          references.push({ type: "function", id: f.id, name: f.name });
        }
      } else if (inventory.workspace?.middleware?.function_post) {
        if (
          inventory.workspace?.middleware?.function_post.some(
            (m) => m.id === mw.id,
          )
        ) {
          references.push({ type: "function", id: f.id, name: f.name });
        }
      }
    }
  });
  inventory.queries?.forEach((q) => {
    const app = inventory.apps.find((a) => a.id === q.app.id);
    if (q.middleware?.pre_customize) {
      if (q.middleware?.pre?.some((m) => m.context.middleware.id === mw.id)) {
        references.push({
          type: "query",
          id: q.id,
          name: q.name,
          appId: q.app.id,
        });
      }
    } else if (app.middleware.pre_customize) {
      if (app.middleware.pre.some((m) => m.context.middleware.id === mw.id)) {
        references.push({
          type: "query",
          id: q.id,
          name: q.name,
          appId: q.app.id,
        });
      }
    } else if (inventory.workspace?.middleware?.query_pre) {
      if (
        inventory.workspace?.middleware?.query_pre.some(
          (m) => m.context.middleware.id === mw.id,
        )
      ) {
        references.push({
          type: "query",
          id: q.id,
          name: q.name,
          appId: q.app.id,
        });
      }
    }
    if (q.middleware?.post?.post_customize) {
    } else if (app.middleware.query_post) {
      if (
        app.middleware.query_post.some((m) => m.context.middleware.id === mw.id)
      ) {
        references.push({
          type: "query",
          id: q.id,
          name: q.name,
          appId: q.app.id,
        });
      }
    } else if (inventory.workspace?.middleware.post_customize) {
      if (
        inventory.workspace?.middleware.post_customize.some(
          (m) => m.context.middleware.id === mw.id,
        )
      ) {
        references.push({
          type: "query",
          id: q.id,
          name: q.name,
          appId: q.app.id,
        });
      }
    }
  });
  inventory.tasks?.forEach((t) => {
    if (t.middleware?.pre_customize) {
      if (t.middleware?.pre?.some((m) => m.context.middleware.id === mw.id)) {
        references.push({
          type: "task",
          id: t.id,
          name: t.name,
          appId: t.app.id,
        });
      }
    } else if (inventory.workspace?.middleware?.task_pre) {
      if (
        inventory.workspace?.middleware?.task_pre.some(
          (m) => m.context.middleware.id === mw.id,
        )
      ) {
        references.push({
          type: "task",
          id: t.id,
          name: t.name,
          appId: t.app.id,
        });
      }
    }
    if (t.middleware?.post?.post_customize) {
      if (
        t.middleware?.post?.post_customize.some(
          (m) => m.context.middleware.id === mw.id,
        )
      ) {
        references.push({
          type: "task",
          id: t.id,
          name: t.name,
          appId: t.app.id,
        });
      }
    } else if (inventory.workspace?.middleware?.task_post) {
      if (
        inventory.workspace?.middleware?.task_post.some(
          (m) => m.context.middleware.id === mw.id,
        )
      ) {
        references.push({
          type: "task",
          id: t.id,
          name: t.name,
          appId: t.app.id,
        });
      }
    }
  });

  const sections = [];
  sections.push(``);
  sections.push(`### ${mw.name}`);
  sections.push(``);
  sections.push(`#${mw.id} [[open]](${getUrl(inventory)}function/${mw.id})`);
  if (mw.description) sections.push(`${mw.description}`);
  if (references.length) {
    sections.push("#### References");
    references.forEach((ref) => {
      sections.push(
        `- ${ref.type}: ${ref.name} [[open]](${
          ref.type === "query"
            ? getUrl(inventory) + "api/" + ref.appId + "/query"
            : getUrl(inventory) + ref.type
        }/${ref.id})`,
      );
    });
  }
  sections.push(...makeFunctionStackMarkdown(mw, inventory));
  return sections;
}

export function makeDocumentation(
  inventory: DocInventory,
  showSteps: ShowStepsOptions,
  instanceHost: string,
  xs: Record<string, any[]>
) {
  return withDocCtx(xs, inventory, instanceHost, showSteps, () => {
    const mds: string[] = [];
    mds.push(...makeWorkspaceOverviewMarkdown(inventory));
    inventory.apps?.forEach((app) => {
      mds.push(...makeAppOverviewMarkdown(app, inventory));
      inventory.queries
        .filter((api) => api.app.id === app.id)
        .forEach((api) => {
          mds.push(...makeQueryAPIMarkdown(api, inventory));
        });
    });
    mds.push(...makeTasksOverviewMarkdown(inventory));
    inventory.tasks?.forEach((task) => {
      mds.push(...makeTaskMarkdown(task, inventory));
    });
    mds.push(...makeTriggersOverviewMarkdown(inventory));
    inventory.triggers?.forEach((trigger) => {
      mds.push(...makeTriggerMarkdown(trigger, inventory));
    });
    mds.push(...makeFunctionOverviewMarkdown(inventory));
    inventory.functions?.forEach((func) => {
      mds.push(...makeFunctionMarkdown(func, inventory));
    });
    inventory.toolsets?.forEach((toolset) => {
      mds.push(...makeToolsetMarkdown(toolset, inventory));
      inventory.tools
        ?.filter((tool) => tool.toolset?.id === toolset.id)
        .forEach((tool) => {
          mds.push(...makeToolMarkdown(tool, inventory));
        });
    });

    mds.push("");
    mds.push(
      `*Documentation generated by [State Change](https://statechange.ai) sc-xano on ${new Date().toLocaleString()}* `,
    );
    mds.push("");

    return mds.join("\n");
  });
}

export function makeAPIDocumentation(
  api_id: number,
  inventory: DocInventory,
  showSteps: ShowStepsOptions,
  instanceHost: string,
  xs: Record<string, any[]>
) {
  return withDocCtx(xs, inventory, instanceHost, showSteps, () => {
    const sections: string[] = [];
    const app = inventory["apps"].find((a) => a.id === api_id);
    if (!app) return "";
    sections.push(...makeAppOverviewMarkdown(app, inventory));
    inventory.queries
      .filter((api) => api.app.id === app.id)
      .forEach((api) => {
        sections.push(...makeQueryAPIMarkdown(api, inventory));
      });
    return sections.join("\n");
  });
}

/** Build a curl example for an API endpoint (uses inventory + instance host). */
export function makeCurlCommand(query: any, inventory: DocInventory, instanceHost: string): string {
  const branchId = inventory.branch?.id;
  const branchLabel = inventory.branch?.label;
  const liveBranchId = inventory.workspace?.branch?.id;
  const app = inventory.apps?.find((a: any) => a.id === query.app?.id);
  if (!app) return "";
  const host = instanceHost;
  const canonical = app.canonical;
  const branchSuffix =
    typeof branchId !== "undefined"
      ? branchId === liveBranchId
        ? ""
        : `:${branchLabel}`
      : "";
  const verb = query.verb;
  const name = query.name;
  const dynamicInputs = (name.match(/\{(.*)\}/g) || []).map((m) =>
    m.replace("{", "").replace("}", ""),
  );
  let inputs: any[] = [];
  if (query.input?.length) {
    for (const input of query.input) {
      if (input.merge) {
        const customize = input.customize;
        const tableId = input.type.split("_")[0];
        const table = inventory.dbos?.find((d: any) => d.id === parseInt(tableId, 10));
        if (!table?.schema) continue;
        table.schema.forEach((column: any) => {
          if (Object.keys(customize).includes(column.name)) {
            const data = customize[column.name];
            if (data.hidden !== true) {
              inputs.push({ name: column.name, ...data });
            }
          } else {
            if (column.name === "id") return;
            if (column.access !== "public") return;
            inputs.push({ name: column.name, default: column.default });
          }
        });
      } else {
        inputs.push(input);
      }
    }
  }
  inputs = inputs.filter((i) => !dynamicInputs.includes(i.name));
  let curlCommand = `curl -X ${verb} https://${host}/api:${canonical}${branchSuffix}/${name}`;

  if (inputs.length) {
    if (!["GET"].includes(verb)) {
      const hasFileInput = inputs.some((i) => i.type === "file");
      if (hasFileInput) {
        curlCommand += ` \\
  -H "Content-Type: multipart/form-data"`;
        for (const input of inputs) {
          if (input.type === "file") {
            curlCommand += ` \\
  -F "${input.name}=@myfilename"`;
          } else {
            curlCommand += ` \\
  -F "${input.name}=${input.default}"`;
          }
        }
      } else {
        curlCommand += ` \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(
    inputs.reduce((acc: Record<string, unknown>, i: any) => {
      acc[i.name] = i.default;
      return acc;
    }, {}),
    null,
    2,
  )
    .split("\n")

    .join(" \n  ")}'`;
      }
    } else {
      curlCommand += `?${inputs
        .map((i) => `${i.name}=${i.default}`)
        .join("&")}`;
    }
  }
  if (query.auth) {
    curlCommand += ` \\
    -H "Authorization: Bearer XANOTOKEN"`;
  }
  return curlCommand;
}
