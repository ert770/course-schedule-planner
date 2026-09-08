// Roadmap #34：對照 `getAgentTools()` 的 JSON Schema 驗證模型送出的 tool call 參數。
//
// **為什麼自己寫而不是裝 ajv**：`getAgentTools()` 實際只用到 7 個關鍵字
// （見 `SUPPORTED_SCHEMA_KEYWORDS`），沒有 `anyOf`／`$ref`／數值邊界／`pattern`。
// 為這個範圍加一個依賴不划算，而且自己寫才能在下面 `collectSchemaKeywords()`
// 加 drift guard——哪天有人在 schema 裡加了沒支援的關鍵字，測試會先紅，
// 而不是驗證器靜默忽略它。
//
// **這個驗證器抓得到什麼、抓不到什麼（定位很重要，不要誤讀它的通過率）**：
//
//   抓得到：非 strict 模式下 API 不保證的兩件事——巢狀 `required`
//   （實測模型會送 `interpretation: {}` 過來，見 `requirementPreflight.js` 的
//   檢查 (11)）與 `additionalProperties: false`（模型自己發明欄位）。
//
//   抓不到：`day: 9`、`period: 99`、`minCredits > maxCredits` 這類值域問題——
//   schema 裡**一個數值邊界都沒有**。那正是 `requirementPreflight.js` 存在的
//   理由：它補的就是 schema 表達不了的東西。
//
// 因此「通過率」對這個驗證器沒有意義（API 已擋掉多數型別錯誤，實務上會一直是
// 100%）。它的用法是**每題的 hard guard**：違反就整題失敗。eval 報告裡要看的
// 變動指標是 preflight-clean rate，不是這裡的百分比。

export const SUPPORTED_SCHEMA_KEYWORDS = Object.freeze([
  'type', 'properties', 'required', 'items', 'enum', 'additionalProperties', 'description',
]);

function matchesType(value, type) {
  switch (type) {
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    // JSON Schema 的 integer 不接受 1.5；`Number.isInteger` 正好是這個語意。
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    // `typeof null === 'object'`，所以 null 一定要在 object 之前單獨判掉。
    case 'null': return value === null;
    default: return true;
  }
}

function describe(value) {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}

/**
 * 依 schema 驗證一個值，回傳「人看得懂的違規描述」陣列（空陣列代表通過）。
 *
 * @param value  要驗的值
 * @param schema JSON Schema 片段
 * @param path   目前位置，用於組出可讀的錯誤訊息（例如 `interpretation.creditGoal`）
 */
export function validateAgainstSchema(value, schema, path = '') {
  const violations = [];
  if (!schema || typeof schema !== 'object') return violations;
  const at = path || '(根層)';

  if (schema.type !== undefined) {
    // `type` 可能是單一字串，也可能是 union 陣列（本專案只有
    // `['integer','null']` 一處，在 interpretation.creditGoal.min/max）。
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => matchesType(value, type))) {
      violations.push(`${at} 型別應為 ${types.join('|')}，實際為 ${describe(value)}`);
      // 型別就錯了，再往下檢查子結構只會產生一串衍生噪音。
      return violations;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    violations.push(`${at} 應為 ${schema.enum.join('／')} 其中之一，實際為 ${describe(value)}`);
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      violations.push(...validateAgainstSchema(item, schema.items, `${at}[${index}]`));
    });
  }

  const isPlainObject = typeof value === 'object' && value !== null && !Array.isArray(value);
  if (isPlainObject) {
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) {
        violations.push(`${at} 缺少必填欄位 ${key}`);
      }
    }

    // `properties` 可能整個不存在——`courseStates` 與 `sourcePhrases` 就是這種
    // free-form 物件（只有 additionalProperties 描述值的形狀）。直接
    // `Object.keys(schema.properties)` 會在這裡丟 TypeError。
    const properties = schema.properties ?? {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (value[key] === undefined) continue;
      violations.push(...validateAgainstSchema(value[key], childSchema, path ? `${path}.${key}` : key));
    }

    // `additionalProperties` 是多型的：根層是 boolean `false`（不准多餘欄位），
    // 但 `courseStates`／`sourcePhrases` 是 schema 物件 `{ type: 'string' }`
    // （任意鍵，但值要符合形狀）。只處理其中一種都會出錯：只認 `=== false`
    // 會讓 free-form 物件的值完全不被驗；用 truthy 判斷則會把 `{type:'string'}`
    // 當成「允許任意值」直接放行。
    const extra = schema.additionalProperties;
    if (extra === false) {
      for (const key of Object.keys(value)) {
        if (properties[key] === undefined) {
          violations.push(`${at} 出現 schema 未定義的欄位 ${key}`);
        }
      }
    } else if (extra && typeof extra === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (properties[key] !== undefined) continue;
        violations.push(...validateAgainstSchema(child, extra, path ? `${path}.${key}` : key));
      }
    }
    // `additionalProperties` 未指定時代表「允許且不驗」——本專案的
    // `blockedPeriods.items` 與 `rejectedCourses.items` 就是這種（有 required
    // 但沒有 additionalProperties: false）。**不要**在這裡自作主張補上嚴格
    // 檢查：那會對合法輸出報假陽性，而假陽性比漏抓更糟——會讓人開始忽略紅燈。
  }

  return violations;
}

/**
 * 驗證一次 tool call 的參數。
 *
 * @param toolName 模型選的工具名稱
 * @param args     模型送出的參數（`parseToolArguments` 的結果；`null` 代表壞 JSON）
 * @param tools    `getAgentTools()` 的結果
 */
export function validateToolCallArguments(toolName, args, tools = []) {
  if (!toolName) return { valid: true, violations: [] };

  const tool = tools.find(item => item.name === toolName);
  if (!tool) {
    return { valid: false, violations: [`呼叫了不存在的工具 ${toolName}`] };
  }
  // `parseToolArguments` 用 null 表示「參數根本不是合法 JSON 物件」。這與
  // 「有呼叫工具但沒帶參數」是完全不同的失敗，要分開講清楚。
  if (args === null) {
    return { valid: false, violations: [`${toolName} 的參數不是合法的 JSON 物件`] };
  }

  const violations = validateAgainstSchema(args ?? {}, tool.parameters ?? {}, '');
  return { valid: violations.length === 0, violations };
}

/**
 * 蒐集一份 schema 裡出現過的所有關鍵字，給 drift guard 用。
 *
 * 目的不是驗證，是「有人加了新關鍵字時要有人知道」——沒有這個，新增的
 * `minimum` 之類會被上面的驗證器靜默忽略，看起來一切正常。
 */
export function collectSchemaKeywords(schema, found = new Set()) {
  if (Array.isArray(schema)) {
    for (const item of schema) collectSchemaKeywords(item, found);
    return found;
  }
  if (!schema || typeof schema !== 'object') return found;

  for (const [key, value] of Object.entries(schema)) {
    found.add(key);
    // `properties` 與 free-form 物件底下的鍵是「欄位名稱」不是關鍵字，
    // 只往下收它們的值。
    if (key === 'properties') {
      for (const child of Object.values(value ?? {})) collectSchemaKeywords(child, found);
      continue;
    }
    if (key === 'required' || key === 'enum' || key === 'description' || key === 'type') continue;
    collectSchemaKeywords(value, found);
  }
  return found;
}

export default { validateToolCallArguments, validateAgainstSchema, collectSchemaKeywords, SUPPORTED_SCHEMA_KEYWORDS };
