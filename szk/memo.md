❯ memoryは揮発しないよね？黒子いなくなったら泣いちゃう                              

⏺ 揮発しません！ファイルとして保存されているので、会話が終わっても次回も読み込まれま
  す。

  /Users/szk/.claude/projects/-Users-szk-Desktop-APP-slackSFA/memory/
  ├── MEMORY.md          ← 毎回ロードされるインデックス
  └── project_nurturing_phase.md  ← Phase A/B の詳細

  次の会話でも「今日やったこと・残タスク・設計判断」は全部覚えています。安心してくだ
  さい！
  木曜日の集会として、以下の週のデータが抜けています：
                                                                                                       
  2025年7月                                                                                            
  - 7/24、7/31                                                                                         
                                                                                                       
  2025年8月                                                                                            
  - 8/7、8/21、8/28                                                                                    
                                                                  
  2025年9月                                                                                            
  - 9/4、9/18、9/25                                               

  2025年10月
  - 10/23、10/30
                                                                                                       
  2025年11月
  - 11/20                                                                                              
                                                                  
  2025年12月
  - 12/18、12/25（クリスマス週）
                                                                                                       
  2026年1月
  - 1/1（元日）、1/8、1/15                                                                             
                                                                  
  2026年2月
  - 2/5、2/19、2/26                                                                                    
                                                                                                       
  2026年3月                                                                                            
  - 3/12（先週 — まだスキャンしてないだけかも）                                                        
                                                                                                       
  ---
  12/25・1/1は祝日休み、夏（7〜8月）や年末年始の長期お休みも含まれているので、実際に「欠落しているスキ
  ャン」かどうかは確認が必要です。5/31（土）の3ファイルは別の特別集会のようです。

---

## toDo.md 毎朝通知 動作の流れ

- スクリプト: `/Users/szk/Library/Scripts/todo_notify.sh`
- LaunchAgent: `/Users/szk/Library/LaunchAgents/com.szk.todo-notify.plist`
- 対象ファイル: `/Users/szk/Desktop/PLAN/toDo.md`

| 状況 | 動作 |
|------|------|
| 10時にPCが起動中 | 10時ちょうどに通知 |
| 10時にスリープ中 → 10〜21時の間に起動 | 起動直後に通知 |
| 10時にスリープ中 → 21時以降に起動 | その日は通知しない（深夜の通知を防止） |
| 同じ日に複数回スリープ解除 | センチネルファイルで二重通知を防止 |

センチネルファイル: `/tmp/todo-notify-YYYYMMDD.done`（PC再起動時に自動クリア）

### 管理コマンド
```bash
# 無効化
launchctl unload /Users/szk/Library/LaunchAgents/com.szk.todo-notify.plist

# 有効化
launchctl load /Users/szk/Library/LaunchAgents/com.szk.todo-notify.plist

# 今すぐテスト
bash /Users/szk/Library/Scripts/todo_notify.sh
```


