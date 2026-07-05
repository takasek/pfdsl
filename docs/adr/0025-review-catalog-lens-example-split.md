# ADR-0025: レビューカタログは抽象レンズを配布、具体例は repo-local instance

- Status: Accepted（2026-07-06 同日改訂 — 当初「C のみ脱固有化・workflow.md へ吸収」としたが、A/B も固有語漏れがあり workflow.md の責務も過剰と判明したため「A/B/C 全脱固有化・専用 instance ファイル分離」に書き直した）
- Date: 2026-07-06

## Context

PFD レビューカタログ `docs/review-perspectives.md`（A/B/C の監査観点）は gen-skill が丸ごと pfdsl スキルの `references/` へコピーし、`pfdsl skill sync` で全採用リポへ配布される。
当初 C（仕様・制約）の具体例が pfdsl 言語仕様の内部機構に密着していた（V025・§15.X の三点登記・`[[SPEC_xxx?]]` 前方参照マーカー・`check-forward-ref-markers.mjs` 等）。
これらは採用リポに存在しない機構であり、pfdsl 内部保守の関心が配布バンドルに漏れていた。
さらに精査すると A（図 vs 現実）・B（粒度・型）も pfdsl 固有名詞まみれだった（`README`・`cli_tool`/`packages/`・`W003`・`published_cli`/`published_libraries`・`payoff_log`・`publish_cli`/`map_deps`・`ADR-0004` 等）。

漏洩の本質は「C が配布される」ことではない。
pfd-retro は C を pfdsl 専用でなく「DSL・プロトコル等の仕様を自リポで保守する任意の採用リポ」向けに一般化して提供しており（SKILL.md のゲート記述）、抽象観点としての A/B/C には配布価値がある。
問題は観点に pfdsl 固有の具体例が焼き込まれていた点にある。
カタログ冒頭の原則「各問いは実際に検出された誤りに由来する」が示す通り、具体例は本質的に repo-local である。
pfdsl で実際に検出された誤りは pfdsl の履歴であって採用者のものでない。
具体例を配布リファレンスに焼き込んだこと自体が層の取り違えだった。

## Decision

レビューカタログを「配布する観点の枠組み」と「repo-local な具体例」に分離する。

1. **配布層（`docs/review-perspectives.md` → スキル `references/review-perspectives.md`）= 抽象レンズのみ**。
   A/B/C すべての観点名・抽象説明を残し、pfdsl 固有名詞を全除去する。
   例示はドメイン中立のイラストか抽象説明に置換し、配布物から this-repo 固有語をゼロにする。
2. **repo-local instance（`.pfdsl/review-perspectives.md`）= 当リポの具体例・機構**。
   剥いだ pfdsl 固有例（A/B/C）と C 機構2件を専用ファイルに集約し、pfdsl 自身の instance として育てる。
   配布物と同名にし（`references/review-perspectives.md` ↔ `.pfdsl/review-perspectives.md`）、「配布カタログの当リポ instance」という対応を命名で示す。
3. **採用者 seed（`scaffold/review-perspectives.md`）= 空プレースホルダ instance**。
   A/B/C の空見出しと「retro で検出した実例を蓄積」の注記のみを置き、採用リポが自分の履歴で育てる起点にする。

instance は独立ファイルとし、workflow.md には**吸収しない**。
workflow.md の pfd-retro バインディングは instance を指すポインタに留め、retro 実行記録（ADR-0024）のみを保持する。

## Rationale

1. **本 ADR は ADR-0023 の鏡像**。
   0023 は固有名詞を含まない汎用ルールが L4 に滞留する問題を「昇格」で解いた。
   本件は逆に、repo 固有の具体例が配布層に混入していた問題を「降格」で解く。
   どちらも architecture.md の層定義（汎用は配布、固有は repo-local）に照らした是正であり、方向が逆なだけで判定軸は同一。
2. **「由来する具体例は repo-local」は A/B/C 一様に効く**。
   当初 A/B の例は「図パターンなので類推転用可能」と残したが、これは合理化だった。
   `published_cli`・`map_deps`・`W003`・`ADR-0004` は採用リポに存在せず、C 機構と程度が違うだけで種類は同じ this-repo 固有語である。
   原則を一様に適用し、配布物は純粋な観点の枠組みに保つ。
3. **レビューカタログは workflow 散文と性質が違うので専用ファイルにする**。
   (a) 手続きでなく参照資料、(b) 特定図に紐づかず横断（A/B は任意図を監査）、(c) 配布物 `references/review-perspectives.md` の鏡像、(d) 無限成長。
   この4性質が単独抽出を正当化する。
   workflow.md に吸収すると手続き散文に参照カタログが混ざり責務が過剰になる。
   instance は図-companion（roadmap/workflow）の三つ組には入れない — PFD 種別（ADR-0017）でなく配布参照カタログの対だから、命名も種別族でなく配布物と揃える。
   将来の兄弟のために prefix n つ組スキームは先取りしない（YAGNI）。真の族が現れて初めて導入する。

## Consequences

- `docs/review-perspectives.md` の A/B/C を全脱固有化した（配布3コピーに this-repo 固有語ゼロ）。
- `.pfdsl/review-perspectives.md` を新設し、pfdsl の A/B/C 実例と C 機構を集約した。
- `.pfdsl/workflow.md` の pfd-retro バインディングは instance を指すポインタに戻した（前段で吸収した C 例示を撤去）。
- `scaffold/review-perspectives.md` を新設し、採用者向け空 seed とした（scaffold/workflow.md の binding も instance を指すポインタに更新）。
- architecture.md の L4 例と spec-stress-test の findings 振り分けを instance ファイル基準に更新した。
- ADR-0007 が「`.pfdsl/` に追加ファイルを自由併置」を既に許容しているため、instance ファイル新設は規約整合。
- カタログを `review-prompts` → `review-perspectives` に改名した。"prompt" は配信形態にすぎず本質は観点（doc 自語「監査観点」）。CLI の機械監査 `--audit`（terminal/external 列挙・`auditGraph`）は spec normative・公開面で entrenched なので据え置き、人間観点側を review と名付けて機械 audit と語を分けた — ADR-0006 の「機械検査 vs 人間判断」の線を名前が体現する。

## References

- `docs/review-perspectives.md`（配布抽象レンズ）
- `.pfdsl/review-perspectives.md`（pfdsl instance — 具体例・機構の育て先）
- pfd-ops `references/architecture.md`（L1〜L4 層定義）
- pfd-ops `references/scaffold/review-perspectives.md`（採用者 seed）
- pfd-retro `SKILL.md`（C 適用のゲート条件）
- ADR-0007（`.pfdsl/` ディレクトリ規約 — 追加ファイル併置の許容）
- ADR-0023（L4 滞留の昇格経路 — 本 ADR の鏡像）
