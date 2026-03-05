#!/usr/bin/env node
/**
 * Claude Guard Hook Script
 * ~/.claude-guard/hook.js
 *
 * Claude Code の PreToolUse フックから呼ばれるスクリプト。
 * コマンドを Claude Guard アプリに送信して承認/拒否を待ちます。
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
      // 許可
      process.stdout.write(JSON.stringify({ continue: true }));
      process.exit(0);
    } else {
      // 拒否
      process.stdout.write(JSON.stringify({
        continue: false,
        reason: 'Claude Guard によって拒否されました',
      }));
      process.exit(2);
    }
  } catch (err) {
    // ガードが起動していない場合 → 許可してフォールスルー
    if (err.code === 'ECONNREFUSED') {
      console.error('[Claude Guard] ガードが起動していません。コマンドを許可します。');
      process.exit(0);
    }
    console.error('[Claude Guard] エラー:', err.message);
    process.exit(0); // エラー時は許可
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
