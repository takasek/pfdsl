---
tags: [method:remove]
phase: pre-artifact
---

- **targetの撤去が名前にない役目を落とす trap**: 名前が示す主目的だけを置き換えてtargetや機構を撤去すると、その内部で兼務していた無名の役目が引き継がれず、離れた下流工程で初めて失敗する。
  問いの形: 「このtargetを置き換えるとき、名前に現れていない役目を誰が引き継ぐか。撤去して壊れるものは撤去箇所からどれだけ離れているか」。
  具体例: `make bootstrap-pfdsl-skill` は名前どおりskillを生成するtargetだが、その過程で5packageをbuildしており、CIのgen-plugin workflowは生成でなくそのbuildに依存していた。skillをsymlink化してtargetを撤去すると生成は引き継がれたがbuildが落ち、fresh checkoutの `make gen-plugin` が `packages/cli/dist/cli.js` 不在で失敗した（#714 のサイクル）。
  対策: 撤去前にtargetが実行するcommandを1行ずつ「名前が約束している役目か」で分類する。分類できない行を暗黙の役目として、依存先と引き継ぎ先を決めてから撤去する。
