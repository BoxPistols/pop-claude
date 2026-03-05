#!/usr/bin/env node
/**
 * pop-claude セットアップスクリプト
 * node setup.js を実行すると自動設定されます
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const HOME = os.homedir();
const GUARD_DIR = path.join(HOME, '.pop-claude');
const CLAUDE_CONFIG_DIR = path.join(HOME, '.claude');
const CLAUDE_SETTINGS = path.join(CLAUDE_CONFIG_DIR, 'settings.json');
const HOOK_SCRIPT = path.join(GUARD_DIR, 'hook.js');

console.log('🛡  pop-claude セットアップ\n');

// 1. ディレクトリ作成
if (!fs.existsSync(GUARD_DIR)) {
  fs.mkdirSync(GUARD_DIR, { recursive: true });
  console.log('✅ ~/.pop-claude ディレクトリを作成しました');
}

// 2. フックスクリプトをコピー
const hookSrc = path.join(__dirname, 'hook.js');
fs.copyFileSync(hookSrc, HOOK_SCRIPT);
fs.chmodSync(HOOK_SCRIPT, 0o755);
console.log(`✅ hook.js を ${HOOK_SCRIPT} にコピーしました`);

// 3. Claude Code の settings.json を更新
let settings = {};
if (fs.existsSync(CLAUDE_SETTINGS)) {
  try {
    settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf-8'));
    console.log('✅ 既存の Claude Code 設定を読み込みました');
  } catch (e) {
    console.warn('⚠️  settings.json のパースに失敗。新規作成します');
  }
}

// hooksを設定
const hookCommand = `node ${HOOK_SCRIPT}`;
settings.hooks = settings.hooks || {};
settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

// 既存のpop-claude設定を削除
settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
  h => !JSON.stringify(h).includes('pop-claude')
);

// 新しいフックを追加
settings.hooks.PreToolUse.push({
  matcher: '*',
  hooks: [{
    type: 'command',
    command: hookCommand,
  }]
});

// 設定を保存
if (!fs.existsSync(CLAUDE_CONFIG_DIR)) {
  fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true });
}
fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
console.log(`✅ Claude Code hooks を設定しました (${CLAUDE_SETTINGS})`);

// 4. 完了メッセージ
console.log('\n─────────────────────────────────────────────');
console.log('🎉 セットアップ完了！');
console.log('');
console.log('次のステップ:');
console.log('  1. pop-claude アプリを起動する');
console.log('     npx electron . (開発時)');
console.log('     または ビルドされたアプリを起動');
console.log('');
console.log('  2. Claude Code でコマンドを実行する');
console.log('     メニューバーのアイコンから承認/拒否できます');
console.log('');
console.log('  設定ファイル: ~/.pop-claude/settings.json');
console.log('  フックスクリプト: ~/.pop-claude/hook.js');
console.log('─────────────────────────────────────────────');
