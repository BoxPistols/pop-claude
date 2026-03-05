# 🛡 pop-claude

Claude Codeが実行しようとするコマンドをローカルで要約・解説し、メニューバーから**許可/拒否**できるmacOSアプリ。

pop-claude が承認したコマンドは Claude Code の「Do you want to proceed?」プロンプトを**自動スキップ**します。GUI で一度承認すれば、CLI 側で再確認は不要です。

## アーキテクチャ

```
Claude Code
    │
    ├── PreToolUse hook (毎コマンド実行前)
    │         │
    │         ▼
    │   ~/.pop-claude/hook.js
    │         │ HTTP POST /check
    │         ▼
    │   pop-claude App (port 3759)
    │         │ 承認待ち...
    │         ▼ ← ユーザーがメニューバーで許可/拒否
    │   permissionDecision: "allow" / "deny"
    │         │
    ▼   exit 0 → Claude Code が判定を受理
  実行 or スキップ（CLI プロンプトなし）
```

### hooks 連携の仕組み

フックは Claude Code の `permissionDecision` API に準拠しています。

| pop-claude の判定 | stdout JSON | Claude Code の動作 |
|---|---|---|
| 承認 | `permissionDecision: "allow"` | **即実行**（プロンプトなし） |
| 拒否 | `permissionDecision: "deny"` | **ブロック**（プロンプトなし） |
| アプリ未起動 | なし（exit 0 のみ） | 通常の「Do you want to proceed?」表示 |

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
            "command": "node ~/.pop-claude/hook.js"
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
        "hooks": [{ "type": "command", "command": "node ~/.pop-claude/hook.js" }]
      },
      {
        "matcher": "Write",
        "hooks": [{ "type": "command", "command": "node ~/.pop-claude/hook.js" }]
      }
    ]
  }
}
```

## ビルド (ネイティブアプリ化)

Electron 製なので、単体で動作する macOS ネイティブアプリ（`.app`）にパッケージングできます。

```bash
npm run build
# dist/ に .app と .dmg が生成される
```

生成された `.app` は Node.js 不要で起動でき、他の Mac にもそのまま配布可能です。

## 設定ファイル

`~/.pop-claude/settings.json`:

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

**アプリ未起動でも安全**: フックは接続失敗時に JSON なしの `exit 0` を返すため、通常の「Do you want to proceed?」に戻ります。コマンドが勝手に実行されることはありません。

**ポート競合**: デフォルトは `3759`。`main.js` の `PORT` を変更してください。

**フックが呼ばれない**: `claude --version` で v1.5+ 以上を確認してください。
