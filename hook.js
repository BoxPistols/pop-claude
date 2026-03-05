#!/usr/bin/env node
/**
 * pop-claude Hook Script
 * ~/.pop-claude/hook.js
 *
 * Claude Code の PreToolUse フックから呼ばれるスクリプト。
 * コマンドを pop-claude アプリに送信して承認/拒否を待ちます。
 *
 * Claude Code hooks の仕様:
 *   - stdin から JSON を受け取る
 *   - exit 0 → 許可
 *   - exit 2 → 拒否（claude が処理をスキップ）
 *   - stdout に JSON を出力 → claude に返す (任意)
 */

const http = require('http');

const GUARD_PORT = 3759;
const TIMEOUT_MS = 35_000;

// stdin から入力を読む
let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  let hookData = {};
  try {
    hookData = JSON.parse(input || '{}');
  } catch {
    // JSON パース失敗 → 許可してスキップ
    process.exit(0);
  }

  try {
    const result = await checkWithGuard(hookData);
    if (result.approved) {
      // 許可 → permissionDecision: "allow" で「Do you want to proceed?」をスキップ
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: result.reason || 'pop-claude で承認済み',
        }
      }));
      process.exit(0);
    } else {
      // 拒否 → permissionDecision: "deny" でブロック
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: result.reason || 'pop-claude で拒否されました',
        }
      }));
      process.exit(0);
    }
  } catch (err) {
    // ガードが起動していない場合 → 許可してフォールスルー（プロンプトは通常表示）
    if (err.code === 'ECONNREFUSED') {
      console.error('[pop-claude] ガードが起動していません。通常のプロンプトに委譲します。');
      process.exit(0);
    }
    console.error('[pop-claude] エラー:', err.message);
    process.exit(0); // エラー時はデフォルト動作（プロンプト表示）
  }
});

function checkWithGuard(hookData) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      tool_name: hookData.tool_name || hookData.tool || '',
      tool_input: hookData.tool_input || hookData.input || {},
      command: hookData.tool_input?.command
        || hookData.tool_input?.cmd
        || hookData.command
        || '',
      session_id: hookData.session_id || '',
      cwd: hookData.cwd || process.cwd(),
      timestamp: Date.now(),
    });

    const options = {
      hostname: '127.0.0.1',
      port: GUARD_PORT,
      path: '/check',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error('timeout'));
    }, TIMEOUT_MS);

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ approved: true }); // パース失敗 → 許可
        }
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}
