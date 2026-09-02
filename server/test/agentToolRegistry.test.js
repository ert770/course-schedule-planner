// Roadmap #25：tool allowlist 的契約測試。
//
// 這份登記表存在的理由就是防止三處定義漂移：`getAgentTools()` 的 schema、
// `executeAgentTool()` 的 switch、還有登記表本身。測試直接讀 `agentService.js`
// 的原始碼掃 `case '...'` 名稱（比照 `courseHistoryDatabase.test.js` 的 H8 做法），
// 不靠人工同步維護第二份名單。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { getAgentTools } from '../src/services/promptService.js';
import {
  AGENT_TOOL_REGISTRY,
  getConfirmationChangeType,
  isRenderableTool,
  listConfirmationChangeTypes,
  listToolNames,
} from '../src/services/agentToolRegistry.js';

function switchCaseNames() {
  const source = fs.readFileSync(
    new URL('../src/services/agentService.js', import.meta.url), 'utf8'
  );
  return [...source.matchAll(/case '([a-z_]+)':/g)].map(m => m[1]);
}

describe('AR1 三處工具名稱集合必須一致', () => {
  test('AR1 登記表 vs getAgentTools() schema', () => {
    const registryNames = new Set(listToolNames());
    const schemaNames = new Set(getAgentTools().map(t => t.name));

    assert.deepEqual(registryNames, schemaNames);
  });

  test('AR1 登記表 vs executeAgentTool() 的 switch case', () => {
    const registryNames = new Set(listToolNames());
    const caseNames = new Set(switchCaseNames());

    assert.deepEqual(
      registryNames, caseNames,
      '登記表與 switch 的工具名稱集合不一致——三處只要有一處漏改，模型就會呼叫到'
        + '「不明的函數呼叫」或永遠呼叫不到剛加的工具'
    );
  });

  test('AR1 不多不少剛好七個工具（改動時請一併確認這個數字）', () => {
    assert.equal(listToolNames().length, 7);
  });
});

describe('AR2 需要兩段式確認的工具，schema 必須有 confirmationToken', () => {
  const schemaByName = new Map(getAgentTools().map(t => [t.name, t]));

  for (const entry of AGENT_TOOL_REGISTRY) {
    test(`AR2 ${entry.name}`, () => {
      const schema = schemaByName.get(entry.name);
      const hasToken = 'confirmationToken' in (schema.parameters.properties ?? {});

      if (entry.confirmation) {
        assert.ok(hasToken, `${entry.name} 登記為兩段式確認，schema 卻沒有 confirmationToken`);
      } else {
        assert.ok(!hasToken, `${entry.name} 沒有登記確認流程，schema 卻帶了 confirmationToken`);
      }
    });
  }
});

describe('AR3 所有工具 schema 必須拒絕未知欄位', () => {
  for (const tool of getAgentTools()) {
    test(`AR3 ${tool.name}`, () => {
      assert.equal(
        tool.parameters.additionalProperties, false,
        `${tool.name} 沒有 additionalProperties:false，模型可以送進任意欄位`
      );
    });
  }
});

describe('AR4 登記表的政策欄位有實際被消費', () => {
  test('AR4 isRenderableTool() 與登記表一致', () => {
    for (const entry of AGENT_TOOL_REGISTRY) {
      assert.equal(isRenderableTool(entry.name), entry.renderable);
    }
    assert.equal(isRenderableTool('不存在的工具'), false);
  });

  test('AR4 getConfirmationChangeType() 對非確認工具回傳 null', () => {
    assert.equal(getConfirmationChangeType('query_course_db'), null);
    assert.equal(getConfirmationChangeType('update_preferences'), 'preferences');
    assert.equal(getConfirmationChangeType('update_student_profile'), 'profile-scope');
  });

  test('AR4 listConfirmationChangeTypes() 剛好是兩段式確認的工具集合', () => {
    const expected = AGENT_TOOL_REGISTRY
      .filter(entry => entry.confirmation)
      .map(entry => entry.confirmation.changeType);

    assert.deepEqual(listConfirmationChangeTypes().sort(), expected.sort());
  });
});
