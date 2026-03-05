# 🛡 Claude Guard

Claude Codeが実行しようとするコマンドをローカルで要約・解説し、メニューバーから**許可/拒否**できるmacOSアプリ。

## アーキテクチャ

```
Claude Code
    │
    ├── PreToolUse hook (毎コマンド実行前)
    │         │
    │         ▼
    │   ~/.claude-guard/hook.js
    │         │ HTTP POST /check
    │         ▼
    │   Claude Guard App (port 3759)
    │         │ 承認待ち...
    │         ▼ ← ユーザーがメニューバーで許可/拒否
    │   { approved: true/false }
    │         │
    ▼   exit 0 (許可) / exit 2 (拒否)
  実行 or スキップ
```

## インストール

### 前提条件
- macOS 12+
- Node.js 18+
- Claude Code がインストール済み

### セットアップ

```bash
# 1. 依存関係インストール
npm install

# 2. フックスクリプトをセットアップ (Claude Code に自動登録)
node setup.js

# 3. アプリを起動
npm start
```

## 機能

### メニューバー
- 🟢 待機中 / 🔴 承認待ちN件 のリアルタイム表示
- **全承認 / 全拒否** のクイックアクション
- **自動承認モード** のトグル

### 承認パネル
- コマンドのシンタックスハイライト表示
- **AI解説**: コマンドの目的を日本語で説明
- **リスク評価**: low / medium / high / critical の4段階
- **タイムアウトバー**: 30秒経過で自動拒否
- 承認/拒否ボタン

### 自動ルール
- **信頼済みコマンド**: `ls`, `cat`, `git status` など → 自動承認
- **ブロックパターン**: `rm -rf /`, `sudo rm` など → 自動拒否
- **カスタマイズ**: 設定タブから変更可能

### 履歴
- 全実行履歴を記録 (承認/拒否/自動/手動)
- 履歴検索機能

## Claude Code hooks 設定

`node setup.js` で自動設定されますが、手動の場合:

```json
// ~/.claude/settings.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude-guard/hook.js"
          }
        ]
      }
    ]
  }
}
```

## 特定ツールだけ監視する場合

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node ~/.claude-guard/hook.js" }]
      },
      {
        "matcher": "Write",
        "hooks": [{ "type": "command", "command": "node ~/.claude-guard/hook.js" }]
      }
    ]
  }
}
```

## ビルド (配布用 .app / .dmg)

```bash
npm run build
# dist/ に .dmg が生成される
```

## 設定ファイル

`~/.claude-guard/settings.json`:

```json
{
  "autoApprove": false,
  "alwaysOnTop": true,
  "showNotifications": true,
  "trustedCommands": ["ls", "cat", "echo", "pwd", "git status", "git log"],
  "blockedPatterns": ["rm -rf /", "sudo rm", "> /dev/sda"],
  "theme": "dark"
}
```

## トラブルシューティング

**ガードが起動していない場合**: フックはタイムアウトせずに `exit 0` で許可します。

**ポート競合**: デフォルトは `3759`。`src/main.js` の `PORT` を変更してください。

**フックが呼ばれない**: `claude --version` で v1.5+ 以上を確認してください。
