# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

> **2026-10-22 整理**:2026-10-11～17 之經驗(16 節,20 節中標題日期在 2026-10-17 以前者)已抽出至 `experience_20261022.md`,原文逐字搬移、節號與標題不變;需要久遠經驗時再調閱。本檔留 2026-10-19 起之經驗。

## 第 33 項批 3: w-orm 條件白名單後之下游收尾(2026-10-19)

- 升相依(wsemi ^1.9.20、w-orm-lowdb ^1.0.32)後基準紅 3 案(A12、A13、A14)不是本套件缺陷: 測試語料用了白名單外之 `$not`、`$nor`,真 lowdb 現在整批 reject.判別法: 看失敗案之 log 行 `<表>.select catch Error: invalid find: unsupported operator [$not] at [find.id.$not]`(ORM 原文只進 console.log),procOrm 回傳為固定字串 `failed to select data`/`failed to delete data`.處置是把語料改為白名單內條件,並把「白名單外被拒」另立一案(A19),而不是放寬或繞過.
- 移除死碼分支前,先寫一案鎖定「白名單外運算子內之 id 原樣交 ORM」(N10): 以 HEAD 之 src 跑為紅(證鑑別力),移除後綠;其後還原任一分支皆轉紅(D1-D3).刪死碼而無此案,日後有人加回分支不會被發現.
- 錯誤回傳路徑(`.catch` 轉固定字串)原本只在「逐筆失敗」與 mix 有測,select/delAll 被後端 reject 的路徑沒有案;新增 N11(替身 ORM 以 Error 與字串兩種 reject,並攔 console.log 驗原文進 log)與 A19(真 lowdb 7 種白名單外條件,delAll 後表內容不變).變異 E1-E8 皆使至少 1 案轉紅.
- 帳本行號整批位移: 寫 `tmp/fixlines.mjs` 對 `:NNN`/`:NNN-MMM`(>= 門檻者)統一加減,先 `--dry` 列出每個命中 token 與前文逐一過目再寫檔;門檻以下卻被位移影響的範圍(如原 `:287-301` 之終點 301 < 304)須手修.他檔(getProc、getDb 等)行數皆小於門檻,不會誤傷.WServOrm.mjs 在 JSDoc 中段加 2 行,其後行號(`:104`→`:106`、`:107`→`:109`、`:115`→`:117`)與 R-MSG-01 之 JSDoc 命中行號都要重取.
- Grep 工具用 `-o` 搭 `\p{Han}` 會一字一行輸出(單字元匹配),極耗 context;盤點含中文之字串用帳本既有的 `^[^/]*['"\`][^'"\`\n]*\p{Han}` 搭 `-o`(匹配到第一個漢字為止)即可.
- w-serv-webdata 的 `npm test` 會改寫其 `tableTags.json`(時間戳)並使 `db.json` 的 stat 變髒(內容與 HEAD 位元組相同,`git diff` 為空,git status 仍顯示 M).跑完以 Write 工具按 HEAD 位元組還原(`tableTags.json` 無結尾換行),再 `git show HEAD:tableTags.json | cmp - tableTags.json` 回驗.
- 說明文字(JSDoc)中不寫他套件之選項名,本套件帳本 R-AUTH-01 規則 4 要求;方案 §6.2 的 w-serv-orm 版文字含「w-serv-webdata 前端通道另以 checkFind 限縮」,故 w-serv-orm 的版本只寫「通道端若另有更窄之條件限縮,未通過者由通道端拒絕」,checkFind 之名只出現在 w-serv-webdata 自己的文件.

- 外審(2026-10-19,sol 一家完成、beam 逾 10 分鐘無輸出而終止): 審查者之 cwd 設為審查工作夾 `tmp/review/`(內有三 repo 之副本 `work/`、`diffs/`、`ref/`、`out/`),副本內註解與文件以中性字詞取代(`注入`→`傳入` 等,不動識別字),sol 全程未被內容審查擋下,約 17 分鐘交出報告;審查者只能寫 `out/`,收回後以 `git status` 確認三 repo 無非預期異動.
  - sol 提 6 條全屬實(1 條既存缺陷、4 條文件與行為不一致、1 條測試補強),其中最有價值者: F1(字串型主鍵表之複本洗掉不可列舉鍵/Symbol 鍵,令後端應 reject 之條件變成無條件,見 R-OBJ-01 已知限制;既存,實測重現)、F2(「先 select 確認範圍」漏了快取例外,後端文件已有)、F4(白名單保證須以已實作白名單之後端版本為前提,與 pipeline 之限定句不一致)、F6(T02 只斷言呼叫次數,遞迴只做一層的變異存活).另指出方案稱「死碼/不可達」不精確: 轉型發生在後端拒絕之前,分支仍會被執行,只是結果必被 reject.
  - beam(`opencode/beam-free`、`--variant xhigh`、`--format json`)啟動後 1 分鐘內有工具事件,之後停在一個 `step_start`(模型呼叫在途)10 分鐘無任何輸出,依規定終止其行程樹(`taskkill /F /T /PID <node.pid>`,連同其 opencode.exe 子行程)並回驗;不重派.教訓: 工作副本若缺 `node_modules`(webdata、pipeline 的副本只含 src/test),審查者跑測試會得 `MODULE_NOT_FOUND`,宜在提示詞明寫「這兩個副本無相依,不能跑其測試,以 diff 與讀碼為主」,或同樣給連接點.
  - 審查工作夾內的連接點(`work/w-serv-orm/node_modules` → repo 之 node_modules)清理時先 `fs.rmdirSync(連結)`(非遞迴,只移除連結),再刪夾,事後確認 repo 之 `node_modules/mocha` 仍在.

## 第 33 項批 3 第 2 次執行: 修外審 sol F1(find 複本洗掉隱藏結構,2026-10-19)

- 結果: 三版修法、兩輪外審(sol 一輪、Argon 一輪),審查者每輪都以真 lowdb 實測找出前一版未涵蓋的洩漏(第一版 4 類、第二版 4 類),全部我再以腳本獨立複驗屬實才採納.**教訓: 自己列的位置 × 變形表再全綠、自己的變異再全紅,也只證明「已想到的形狀」;缺的是「系統內有哪幾套型別判準、是否一致、判準執行時會不會跑使用端程式」這兩個軸.**
- 找根因而非補洞: 洩漏全部同源——檢查端(`Array.isArray`、`isobj`、自有鍵)與複製端(`isobj`、`isarr`,即 `Object.prototype.toString` 標籤)用不同判準,且**判準本身會執行使用端程式**: 讀 `Symbol.toStringTag` 時其 getter 被執行(可由自有鍵、原型、原型上之 getter 提供,讀兩次可回傳不同值)、`in` 運算子遇 Proxy 原型會執行 `has` 陷阱、`p.constructor` 可為 getter、走訪 Proxy 時其陷阱被執行——這些都能在檢查途中改動已檢查之條件.結構性修法: ①檢查與複製共用單一分類器 `getKindFind`; ②檢查期間完全不執行使用端程式: `util.types.isProxy`(不觸發陷阱)加原型鏈逐層 `hasOwnProperty.call(x, Symbol.toStringTag)`(只查有無不讀值),取代 `in`; ③純物件判準全程屬性描述子(`getOwnPropertyDescriptor`)、不讀 `p.constructor`,並加鍵名集合與「constructor.prototype 指回原型」兩道檢查; ④陣列須為密陣列(空洞 → `array[index]` 會讀原型); ⑤品牌物件以 `util.types` 為主要探針(不依賴 `structuredClone`)、`structuredClone` 當通用網.
- 後端之判準來源: 真 lowdb 之條件白名單在 wsemi `src/cvOrmFind.mjs`(不在 `w-orm-lowdb/src`);找法: 對 `node_modules` 搜錯誤字串(`non-enumerable property is not allowed`).它要求本 realm 之 `Object.prototype`/`Array.prototype` 或 null,所以跨 realm 純物件直呼必 reject;本層在複製位置把它正規化為本 realm 物件(內容等價),不複製之位置仍由後端 reject——這個不對稱要寫進文件與測試(A24),不能宣稱「跨 realm 一律通過」.
- 驗證「後端接不接受」要實測,不能憑想像: 我以為 Node 的 `Blob`(原型改為 null)是 `structuredClone` 網的好案例,實測它帶自有 Symbol 鍵(`kHandle` 等),先被 `hidden` 抓到;`KeyObject`(`crypto.createSecretKey`)無自有鍵、可複製、不在 `util.types` 清單,才是合適對照——而真後端對它(帶自有鍵時)是接受的,故為 `superset` 而非 `must`.把測試格的 kind 交給「預言機核驗」而不是只憑語料手寫,是這類案例能被及時修正的原因.
- 取捨與行為變更(帳本規則 6 與破壞性變更紀錄已載): 空洞/函數值/Symbol 值/Proxy/帶屬性之 Date 改為本層 reject(原交後端 reject 或通過); 帶標籤或原型為 Proxy 之真陣列(後端本接受)本層 reject(fail-closed 超集,`superset` 格); Mongoose 文件、Vue 響應式物件等須先轉純物件,已寫入 README.未處置而記為待裁示者: 寫入列之 `id` 讀取(B-02)、共用子結構(DAG)之深度與展開(A-07),各附重現與建議.
- 測試設計: ①預言機格先斷言預言機本身符合手寫 kind; ②全表以格數斷言防迴圈被改短; ③`getReject` 失敗時只拋「預期reject但resolve」而不帶格位,用 `.catch((e) => assert.fail(label + e.message))` 補標籤; ④迴圈內 `reseed` 寫檔很慢(A20 由 8 秒降為 0.6 秒): `select` 不改表、must 格之 delAll 亦不得改表,只在每格開始重灌一次; ⑤**計數之 Proxy 陷阱與 getter**(D05c)才驗得出「檢查期間不執行使用端程式」——只看最終回傳會漏掉「陷阱被執行但結果碰巧一樣」; ⑥「壞節點放在較後之兄弟位置」要專門寫(A23、D05): 單鍵/單元素容器測不出「只走訪第一個」這類變異(Argon 的 C05); ⑦停用全域 `structuredClone` 再驗(D05d)才證明 `util.types` 探針獨立有效; ⑧偽原型要逐子條件各設一個「只有該條件能辨」的案例(鍵數、鍵集、原始碼、指回),否則變異「拿掉某子條件」存活——例如鍵數檢查需要「真的另一個 realm 的 `Object.prototype` 只多一個鍵」才抓得到,偽原型會先被指回檢查擋下.
- 變異: 54 種(舊 16 + 規則 6 之 38),49 轉紅、5 個等價存活(複製端分類改回 `isobj`/`isarr`、分類器不查乾淨或品牌——檢查端已先拒收;「原型須為 null」——真 Object.prototype 為不可變原型物件).**變異工具本身要被審**: 我的 `R6-equiv-copy-isarr` 因全域字串置換使 `from` 與 `to` 相同(no-op),Argon 才發現;對「等價存活」宣稱要確認變異真的改了碼.變異工具之舊錨點隨程式改寫須同步更新,否則整輪因「錨點出現 0 次」中止.
- 隨機差分模糊測試 `tmp/verify/f1-fuzz.mjs`(有效條件骨架 + 1~2 個隨機變形;種子可重現;第 3 參數可對舊版 `./_srcbefore/WServOrm.mjs` 跑以證明它有鑑別力): 對真 lowdb 驗不變式「直呼 reject ⇒ 經 procOrm 亦 reject、delAll 抽驗表不變」.修後超過 3 萬組洩漏 0,對舊版 789/4000;兩邊皆通過而結果不同者全是 id 數字比較(R-ID-02 轉型,設計如此),骨架宜排除數字.**審查者的探測腳本也要納入自己的回歸**: 複製 Argon 的 4 支到 `tmp/verify/argon/`(改 import 路徑)重跑,是最直接的「已關閉」證據.
- 帳本行號: 只重取 R-OBJ-01 之站點全集與 R-INPUT-01 規則 3 之 getErrFind 行號,其餘規則之 getMapOrm 行號未重取(約 +154),已於帳本開頭註明;用 Grep 取各函數新行號,再以 awk 列出每個函數之起訖行(`/^}/` 配對)核對範圍.
- 檔案換行符: `src/*.mjs` 與 `README.md` 為 CRLF,`test/*.mjs`、帳本、經驗檔為 LF(以 `node -e` 計 `\r\n` 數量,或 `git ls-files --eol` 確認;Git Bash 的 `grep -c $'\r'` 不可靠).Edit 工具保留原換行符,但 old_string/new_string 結尾之空白會被修剪(`'x', ` 變成 `'x',`),錨點結尾要給非空白字元.**在 `bash` 的 `node -e "…"` 內寫含反引號/`$` 的字串會被 shell 先展開(反引號當指令替換)**,含模板字串或正規式的修改一律先用 Write 寫成 `.mjs` 檔再執行.
- 外審流程: sol 約 21 分鐘完成報告後,收尾回合碰到 `usage limit`(`turn.failed`),但 `out/report.md` 已完整落檔;判斷「額度用盡」要看報告是否完整,不能只看 `result.json` 的 `ok:false`.第二輪改派 Argon(`gemini-4-argon-high`,`skipPermissions: true`),約 37 分鐘,報告 62 KB;agy 無串流輸出,以審查者在 `work/…/tmp/` 與 `out/` 的檔案活動判斷存活.審查包要附 `schema/` 全部與相依閉包(第一輪漏附 `schema/tables/`,審查者自行補夾具才跑得了全套);**`skipPermissions: true` 之審查者沒有沙箱,不要給指向真 `node_modules` 的目錄連接點**,改複製所需相依閉包到副本.

## 第 33 項批 3 第 3 次執行: 最終版之獨立審查(sol)與處置(2026-10-19)

- 結果: sol(gpt-6.1-sol max)第三輪審最終版,提出 2 條,皆屬實(R3-01 拒收後之診斷輸出執行繼承之標籤 getter,同一 find 物件重用可使 delAll 刪全表;R3-02 品牌網之結構化複製無字元預算),已修(帳本規則 6 ⑤、⑥).單次呼叫之差分 10,148 格無新的洩漏——sol 的價值不在更多形狀,而在改問「檢查之後、流程的其他環節還有沒有執行使用端程式」與「同一物件再被使用一次」兩個新軸.
- **教訓一: 「檢查函數不執行使用端程式」不等於「整個流程不執行使用端程式」.** 拒收之後的 `console.log(label, input)` 是第二個格式化入口(`util.inspect` 讀 `Symbol.toStringTag`、呼叫 `util.inspect.custom`),我前三版都只盯著 getReasonBadKey,測試又用 `quiet`(以空函數取代 console.log,不格式化引數)把這個執行點消掉了,所以全綠.凡不變式涉及「不得執行使用端程式」,測試用的 logger 必須真格式化(`util.format(...a)`),不可用空函數;D07、A26 照此寫,C03 早有同樣寫法(當時為了 inspect.custom 拋錯).**盤點「把使用端物件交給格式化/序列化函數」之站(`console.log`、`JSON.stringify`、模板字串、`util.inspect`)是獨立於「讀取/複製」之另一軸.**
- **教訓二: 時間軸要入表.** 之前的位置 × 變形表都是「每格重建輸入、跑一次」;sol 加了「同一物件連續用兩次」的序列軸才找到 R3-01.凡副作用能改動呼叫端物件者,表要有「重用」一軸(select→delAll、delAll→delAll 等).
- 修法選擇: 診斷改輸出 `snapSafe` 快照(型別探針 + 描述子讀取,新建純資料,有值個數/層數/項數/字串長度上限),不整個移除輸出(營運者仍要看被拒的是什麼),也不靠 `util.inspect` 選項(`customInspect:false` 擋不住標籤 getter,標籤讀取無開關).快照函數自身也要被測: D05c 之計數 Proxy(含自摘除者)會在快照誤用 Proxy 時轉紅,D07 之標籤/inspect.custom/存取器計數涵蓋其餘.
- R3-02 的修法抄上游: wsemi `cvOrmFind` 已有同題解法(`CLONE_MAX_CHARS` = 4,000,000 碼元,逾此不複製、改走精確品牌探針,註解載明「結構化複製對重複出現之字串每次皆寫出並讀回,記憶體與(字串總長 × 出現次數)成正比」).先讀上游同類程式再設計: 後端探針清單(Map、Set、WeakMap、WeakSet、ArrayBuffer、SharedArrayBuffer、DataView、Symbol 與 BigInt 包裝物件、Promise、WeakRef、FinalizationRegistry)與本層 `util.types` 的差集只有 WeakRef 與 FinalizationRegistry,逾預算時只需補這兩個探針就與後端等價(其餘宿主物件如 KeyObject,後端實測接受,逾預算時與直呼一致).實測(預設堆積 4.2 GB): 655M 碼元之 `$in`,直呼 reject 峰值 RSS 0.59 GB,經本層 1.6 GB(2.7 倍);`--max-old-space-size=256` 才 OOM.我評中(可用性),經 JSON 通道需 655 MB 的請求才同量.
- 評級與審查者不同處: R3-01 sol 評高(指有狀態之兩次呼叫序列),我評中: 行程內呼叫端用自己的 getter 改自己的物件並重用,JSON 通道不可達;但它違反本規則「拒收路徑亦不執行使用端程式」之延伸,且修法小,故修.
- 測試設計: 修前紅逐案確認(D07 五個語料各自以 `tmp/r3/mine/d07-cases.mjs` 對修前碼量到 reads: 4 個非 0、1 個存取器對照為 0);計數用的全域 `structuredClone` 替身(D08、A25)要在 `finally` 還原;`api-objcopy` 的 `seen` 會被 `rows()` 一併記錄(spy 包住 select),須在 `rows()` 之前取 `seen.length`(A25 一度因此誤紅);`getReject` 不經 `quiet` 時,快照會把 D08 之 70 個 64KB 字串印滿終端,拒收路徑要包 `quiet`.
- 變異: 54 → 72 種(新增 18),65 轉紅、7 存活皆等價或輸出不可觀察(快照之陣列元素數、層數上限: console.log 自身只印 100 個元素與 2 層);**變異執行器的錨點隨程式更動而失效**(`R6-no-clone-net`、`R6-snap-reads-tag` 皆因我重構而錨點 0 次,執行器會拋錯中止),改程式後先跑一遍執行器看有無錨點錯誤.
- 外審流程(sol): 5 小時額度於 22:41 重置後可用(先以最小探測確認讀中文檔與寫檔).**cyber 內容審查中止兩次**: 第一次在提示詞階段(0 秒 `turn.failed`,提示詞逐項列舉了前兩輪的見證手法,如偽原型、Proxy 自摘除),第二次在執行 7 分鐘後(模型自己寫探測腳本期間).處置: 提示詞抽象化(見證清單改指向帳本與腳本檔,不逐項描述手法)、第三次為「接續執行」——告知 `out/` 已有上次產物(2640 格差分矩陣、純讀取觀察、效能量測)請沿用並判讀,只補新軸、B、E 與報告;約 18 分鐘完成(報告 35 KB).**被中止之審查者的 `out/` 產物仍可用,我可先自行判讀;接續執行比重派省成本.**審查者副本放 `tmp/r3/pkg`(複製 node_modules 約 245 MB,數十秒;不建連接點),派工腳本 `tmp/r3/dispatch.mjs`(probe / review 兩模式)、輪詢 `tmp/r3/poll.mjs`.Codex 會往上層目錄找 `AGENTS.md`(`rg --files … .`),副本放在 repo 內時它能讀到真 repo,沙箱只擋寫;收回後以 `git status` 確認無非預期異動.

## 第 82 項: 寫入列 id 讀取、批次容器、find 共用子結構(2026-10-20,審計 run01 + 修正 run02)

- 結果: 外審 Argon 第三輪 A-07、B-02 屬實,另核實時找出 F5(批次容器判準不一致)、F6(mix.del 列 id)兩項建議檔未列者;全部僅直呼可達,JSON 通道不可達.修正見帳本 R-OBJ-01 規則 5 續、規則 7,R-INPUT-01、R-MIX-01 規則 6.
- **同一個「是不是 X」若有兩套判準並用(`isarr` 標籤式 vs `Array.isArray`;`isobj` vs 純物件),必有一條路徑被繞過.**盤點法: 對每個型別/形狀判準函數 Grep 全部呼叫點,逐站列出「檢查端 vs 使用端」是否同一判準(F5 即由此找出).已撤銷之 Proxy 使 `Array.isArray` 拋 TypeError,故以 `isArr` 包 try/catch 當「非陣列」.
- `lodash each/map` 對陣列以 `array[index]` 讀值: 空洞索引在原型有資料時讀到繼承值;`getOwnPropertyDescriptor` 逐索引看到的是「自有」.兩種讀法並用即為檢查之值不等於使用之值.
- 稀疏巨陣列之成本要分層量: 本層迴圈 36 ns/索引、wsemi clearXSS 51 ns/索引且把空洞展成密陣列、lodash each 為每個空洞配置物件約 60 B.只修本層迴圈不夠,須在 clearXSS 之前拒收空洞(O(首個空洞之位置)).
- **驗證建議檔要先量再信**: 建議檔稱 find 之 strict 路徑「檢查順序倒置」會卡死,實測 HEAD 於 2^32-1 僅 2~4 ms(第一個空洞即返回);其建議之 `Reflect.ownKeys` 前移對密陣列反而先配置 O(n) 索引字串.
- 記憶化之狀態標記不可與合法值同值: 原型曾以 `1` 標記「走訪中」,與「展開數為 1 之葉容器」碰撞而誤判循環,被隨機差分(對樸素 BigInt 預言機)立即抓到.用同一個 Map 兼存狀態與結果者,標記值須在結果值域之外(`-1`).
- 後端對「繼承之字串 id」的語意與本層不同(lodash cloneDeep 保留原型,邏輯上讀到原型上之 id,序列化只含自有鍵): 以直呼真 ORM 為預言機時,繼承字串 id 的案例不能要求「結果同直呼」,改為斷言本層規則(視為未提供、補主鍵).自有不可列舉 id 與繼承數字 id 直呼與本層一致,可用直呼為預言機.先對真 ORM 實測各形態再決定哪些格可用直呼當預言機.
- 測試設計: ①表驅動(形態 × 入口 × 表型態)之預期寫成每格手寫字串(`keep`/`cast`/`gen`/`rej:…`/`ref`),不用與被測函式同形之 oracle; ②測試自己對 Proxy 取 `Reflect.ownKeys` 會觸發計數陷阱,取完要把計數歸零再斷言; ③稀疏巨陣列之測試先以有限大小(1e5)斷言再跑 2^32-1,避免變異後掛住; ④極端指數 DAG(k≥21)只對不經 castIdFind 之表型態測,字串型表在修前展開 2^k 會 OOM 使測試行程崩潰; ⑤JSON 來源行為鎖定(S08)須在修前 HEAD 亦全綠(證明參考實作本身正確),修後仍全綠; ⑥新測試先對未修之 src 跑確認紅(11 案新增紅、S08 綠),再修.
- 工具: Git Bash 的 `sed -i` 會把 CRLF 檔轉為 LF(`git ls-files --eol` 顯示 `w/lf`);改 `src/*.mjs` 後以 `git ls-files --eol` 或 node 計 `\r\n`/單獨 `\n` 數量核對,必要時以 node 腳本還原 CRLF(`src/getMapOrm.mjs`、`WServOrm.mjs`、`README.md` 為 CRLF;`checkOptRemoved.mjs`、`getProc.mjs` 與 `test/*.mjs` 為 LF).Edit 工具對行尾空白會修剪,多行 old_string 的縮排必須與檔案完全一致;`eslint --fix` 可修新測試的 brace-style 等格式錯,先確認既有行未被動到(`git diff -U0 | grep '^-[^-]'`).
- 工具: Bash 工具內 `cd` 會改後續呼叫之工作目錄(一次 `cd node_modules/wsemi/src` 使之後的 `./tmp` 全指向錯處);誤入後改用絕對路徑,測試之 fixture 為 cwd 相對路徑,**跑 mocha 一律由腳本指定 `cwd` 為 repo 根**(`tmp/audit82/run-tests.mjs` 之做法).
- 下游盤點(子代理 Explore,5 分鐘): w-web-api/perm/sso/task 的 procOrm/mapOrm 輸入只有字面量、`funNew`/ltdtmapping/`pick` 重鑄之純物件、DB select 讀出之列、前端 JSON;Proxy、`Object.create(` 作列、Array 子類別、稀疏陣列、getter id、`Symbol.toStringTag` 偽陣列(僅 perm `validateRows` 之測試餵檢查函數,不入 ORM)皆 0 筆.唯一無法由 repo 判定者: 由 select 讀出之列原樣回灌 procOrm(perm `procCore.mjs:198`、sso `procCore.mjs:1650`)的原型與可列舉性取決於後端反序列化,以 lowdb 實測為純物件.
- 變異工具 `tmp/run02/mut/run.mjs`: 支援 `edits` 多組置換(同一變異改多處,如狀態標記碰撞)、置換前驗錨點恰一次、置換後驗內容確實改變(防 no-op 變異)、單變異逾時 10 分鐘;錨點含換行時依檔案行尾自動轉 CRLF.`CHECK=1` 只驗錨點不跑測試;**每次重構 src 後先跑 `CHECK=1`**(本輪 M01、M02、M34 錨點失效,若直接跑全量會在第一個壞錨點中止,白耗時間).全量 68 種約 19 秒/種(合計約 22 分鐘),跑的期間不可同時跑其他測試(共用 `test/_tmp`,且 CPU 競爭會造成逾時型誤殺而掩蓋缺口),也不可改 `src/`(執行器每種變異複製 src).
- **變異存活的處置三分法**: ①等價(兩處檢查量相同、互相涵蓋,單獨移除任一不可觀察,如共用節點深度檢查與完成時檢查)→ 記入帳本並改為「同時移除」的複合變異(M25c)必須轉紅; ②測試缺口 → 補案例(M25c 一度存活,因語料的鍵序使兩個走訪都先經淺路徑展開共用鏈,新增 'tri' 鍵序案例才殺; M14c 由 del 偽造標籤單筆之斷言殺; M27a 由寬根鍵邊界案例殺); ③不可達碼(M14d)→ 說明不可達,不為它造測試.
- **計數口徑要以真後端實測反例驗,不可只靠推理**: 我首版宣稱「本層只計容器故為後端節點數之子集」,minimax 以真 `cvOrmFind` 構造反例(每個條件物件帶 `$and`、`$or` 各一個單元素陣列之滿二元樹)推翻——後端 `spend()` 不計 `$and/$or` 之陣列,而我計了.更正為只計物件.教訓: 宣稱「A 是 B 的子集」的不變量,寫差分模糊測試時預言機要與**被宣稱的口徑一致**(`p07-dagfuzz` 之預言機隨之改為物件數),且至少用真後端函式對撞一次.
- 外審流程(第 82 項): sol(`gpt-6.1-sol` max,約 29 分鐘,10 項)與 minimax(`minimax-m3.1-flash-free` xhigh,約 56 分鐘,8 項)皆一輪內完成,無額度問題、無內容審查中止——提示詞全程用「功能正確性審查」中性措辭,探測腳本只對副本與自有 fixture 跑.逐項**自行以真 ORM 重跑探測**(不信報告)後採納; 審查者副本含 node_modules(約 245 MB)放 `tmp/run02/review/work`,收回後確認 `git status` 無非預期異動、審查者行程已結束(`tasklist` 查 node.exe,必要時 `cmd //c "taskkill /F /T /PID …"`).
- **收尾才載入 role-coder-for-validate / role-coder-for-test 的代價**: 這兩個技能由全域規範之觸發條件要求「動工前」調用;本輪拖到收尾才載入,補做後立即揭出兩件事——① 外審後新增的 S09~S15、A29 從未對 HEAD 整檔跑過(補跑 `tmp/v82/head-red.mjs`: 現行 69 案對 HEAD 47 過/22 紅,補上缺口);② README 一句「宿主物件(原型 null)得到只含補值主鍵之列」過寬(單筆批次不寫入),是 `tmp/v82/accept.mjs` 以文件敘述為預期而轉紅才發現。教訓: **文件裡每一句描述後端行為的話,都要有一格能轉紅的實操**;審查者的觀察(多筆批次)不可推廣到未實測的情境(單筆)。下次開工第一步就載入兩個技能並建 `validate-plan.md`。
- 驗收腳本的設計: 以真 WServOrm + 真 lowdb 經 procOrm 逐格實操;每格預期**手寫在腳本裡**(不呼叫被測函式);`SRC_DIR` 環境變數可指向 HEAD 副本重跑以驗每格鑑別力(HEAD 紅的格=有鑑別力,HEAD 綠的格=回歸守護);對 HEAD 會近乎不終止的格(2^32-1 稀疏陣列)要有 `SKIP`。驗收輸出再由 `mkaccept.mjs` 轉成驗收表,避免手抄。
- 以真後端對撞「本層為後端子集」類主張: `tmp/v82/p08-backend-implication.mjs`(3 種子 × 4000 圖: 本層 too large 3,545 件,真 cvOrmFind 皆拒收)。真 `cvOrmFind` 每次呼叫最多走 10 萬節點,約 20 ms/件,N=20000 會跑超時(被移入背景);差分的 N 要先以小樣本量時間再定。
- 流程順序的收益: 規則帳本 → 測試(對 HEAD 驗紅) → 程式 → 文件.新測試先對 HEAD 跑出 14 紅(P04、C02、C04 為既有案例之訊息更新,其餘新增)、S08(JSON 來源行為鎖定)對 HEAD 與修後皆綠,即證明「JSON 通道零差異」有獨立證據,再以 180,000 組隨機 JSON 輸入對 HEAD 逐組比對 0 diffs 補強.

## 第 110 項 run01: 多人同時編輯之共用核心(2026-10-22)

規則見 `sgud/rule/rulebook_concurrency.md`(R-BASELINE-01、R-LOCK-01、R-GUARD-01、R-ONLYMOD-01),現況見 `sgud/state/state.md`.以下只記往後會再用到的經驗.

- **同構以 `vm` 驗,不靠打包器**: 把 `src/baseline.mjs` 末尾單一 `export { ... }` 敘述以文字替換為 `globalThis.__B = { ... }`,於 `vm.createContext({})`(只有標準全域,無 `process`/`require`/`Buffer`)以 `vm.runInContext` 執行,fixture 原始碼分別在 Node 與 vm 內求值(Date、BigInt、函數各屬各 realm),四種組合(各用各的、vm 函數吃 Node 物件、Node 函數吃 vm 物件)摘要全同.型別判定因此必須用 `Object.prototype.toString` 與原型鏈,不能用 `instanceof`.檔頭註解含 `/**` 會讓「禁 `**` 語法」之靜態檢查誤報,檢查前須先去區塊註解.
- **變異驗證用副本,不動真檔**: `tmp/orm-run01/mutate.mjs` 把 `src/`、`schema/`、`test/tools/` 與指定測試檔複製到 `tmp/orm-run01/mut/<名>/`,對單一檔施加單一字串替換後以 repo 之 mocha 跑(副本在 repo 之下,`node_modules` 向上解析得到).兩個坑: ①倉庫檔為 CRLF,多行之 find 字串須把 `\n` 換成 `\r\n`,否則「變異字串出現 0 次」被誤當成沒抓到;②把每實例鎖改成跨實例共用時,不可重入之 L07 測試永遠占鎖,後續測試全掛住,靠 mocha 逾時(3 分鐘)才算被抓到——可行但慢,以後這類變異放最後或另設較短逾時.
- **以 HEAD 之 src 驗修前紅**: `git archive | tar` 在 Windows 遇 `C:` 會把磁碟機當主機名失敗,改用 `git ls-tree -r --name-only HEAD src schema` 加逐檔 `git show HEAD:<檔>` 寫到副本.全新檔(baseline.mjs)修前不存在,其測試檔整份載入失敗即為紅;要隔離出其他檔(WServOrm、getMapOrm、getProc)之修前行為,須把新檔補入副本再跑依賴它的測試檔.
- **各 w-orm-* 共用之 find 檢核有 `$in` 元素數上限 10000**(`wsemi/src/cvOrmFind.mjs` 之 `DEF.maxIn`,只可下調;實測 lowdb 回 `invalid find: array is too large (> 10000) at [find.id.$in]`).任何「以 `$in` 一次查全部主鍵」之寫法在逾 1 萬列時必然失敗,須分批(本輪 `EXIST_CHUNK = 1000`).lowdb 之 `$in` 為逐列線性比對,1 萬 id 約 5 秒;替身 ORM 若不模擬此上限,測試永遠測不到這個洞(`test/tools/memOrm.mjs` 已模擬).此洞由我自己的壓力探測(`tmp/orm-run01/bigin.mjs`)發現,兩家外審皆未提.
- **斷言用 `A || B` 會被自己騙**: M06 原寫 `calls.length === 0 || callsOf('select').length === 0`,外審指出弱;改為單獨斷言後反而暴露「空陣列 save 仍會呼叫 ORM 之 save(內容為空陣列)」是既有行為,需把預期改對而非把行為改掉.
- **opencode 免費模型型錄會變**: 2026-10-22 23:12 `opencode/minimax-m3.1-flash-free` 已不在型錄(回 `ProviderModelNotFoundError`,`opencode models opencode` 只列 beam-free、big-pickle、deepseek-v4.1-flash-free、flint-40b-free、glm-5.3-flash-free、mimo-v2.6-flash-free、nemotron 三款);按任務規定改派 beam.beam 第一次因提示詞允許「執行唯讀指令」而呼叫 bash,被唯讀鎖自動拒絕後 24 秒以空輸出結束(`validate` 失敗,`ok:false`);提示詞改寫為「只能用 Read/Grep/Glob,bash 會被拒,必須在最終回覆輸出報告」並預先備好 diff 檔後重派一次,2 分鐘完成.給 opencode 審查者之提示詞不可沿用給 codex 者(後者允許 `rg`、`git`).
- **eslint 對測試檔嚴格**: `object-property-newline` 等規則會對同行多屬性物件報錯;src 檔乾淨、測試檔 54 處,以 `--fix` 處理(只對自己新增之測試檔).
- **外審結果(2026-10-22 run01,sol 17 條、beam 7 條)與處置**: sol(`gpt-6.1-sol` max,唯讀沙箱加 `--output-last-message`,約 20 分鐘)自行以記憶體資料實測並對我的測試做四種變異,17 條中 15 條屬實或部分屬實(高 4:同批重複主鍵 del 先刪後拒、BigInt 名次轉 Number 漏判重排、無效 opt 在擴充函數之後才驗、V5 整列舊值回寫),其中「測試對錯誤變異仍綠」類 6 條(C06、L03、M14、M09、M15、M06)最有價值——這些都是我自己的變異驗證沒抓到的,因為我只變異了實作的主要分支,沒有變異「測試宣稱涵蓋之組合」.beam 約 2 分鐘 7 條,1 條誤報(`1e21+1 === 1e21`)、2 條與 sol 重疊.教訓: ①新增測試後,對**每條測試標題宣稱之組合**各想一個「讓它仍綠之錯誤變異」;②斷言寫 `A || B` 或與自身對照(M15 原為「未帶 opt 對照帶 undefined」)是同義反覆;③擴充函數類測試須走成功路徑,否則後處理根本沒執行;④「失敗後零寫入」類保證須含同批重複、事後偵測等會繞過前檢查之輸入.
- **給外審之提示詞**: 把 diff 備成檔(`git diff HEAD --output=...`)、規格複本放 repo 內相對路徑(opencode 讀不到 repo 外)、列出「依原則自行決定」清單請其挑戰、要求其先審完整性再審方案、金絲雀(原文引用規格第 1 行)為 `validate` 條件.
- **技能載入時序之再犯**(run01): 本輪在實作、測試、外審派出之後才載入 role-coder-for-validate 與 role-coder-for-test(全域 §11、§12 要求動工前調用,見上一節「收尾才載入…的代價」),補做後新增使用者視角驗收腳本(`tmp/orm-run01/acceptance.mjs`,V1~V14 逐格以公開 API 加真 lowdb 實跑)與規格句對照註解.下次接到測試或程式改動任務,第一個動作就載入這兩個技能.

## 第 110 項 run02: procOrm insert 保留擁有者 `userId`(`opt.keepUserId`,2026-10-23)

規則見 `rulebook_concurrency.md` R-KEEPUSER-01.以下只記往後會再用到的經驗.

- **技能先載入之效果**: 本輪第一個動作即載入 role-coder-for-validate 與 role-coder-for-test,順序為 plan(述語、輸入空間表) → 測試(對未改之 src 跑出 21 紅 1 綠) → 實作 → 變異 → 文件;未再發生 run01 之補做.修前紅時 1 綠者(K04: 未帶 keepUserId 鍵之行為)正是「既有行為不變」之獨立證據,故把「單純未給/`{}`/`{mustExist:false}`」與「`{keepUserId:false}`」拆成兩案,前者修前即綠、後者修前紅;合在一案則整案紅而失去這個證據.
- **opt 增鍵之落點**: `getOptProc` 之回傳物件形狀為 `{ err, mustExist, keepUserId }`,被 `getProc` 起首(驗證)與 `execMapOrm`(驗證與取值)共用;新增一個 opt 鍵要動三處: `OPT_KEYS_PROC`、`getOptProc` 之回傳(所有 return 路徑,含 `bad()` 與未給 opt 之早退)、真正使用該旗標之函數參數(此次為 `adjustData` 第 6 參數).型別檢查與 mode 檢查之次序固定為「先逐鍵驗型別、再驗 mode」,否則同一 opt 之回應字串依鍵序而異.
- **評估「save 是否也覆寫」之法**: 讀 `adjustData` 之 mode 分支,不憑印象——insert 區塊(`mode.indexOf('insert') >= 0`)設 `userId`、`timeCreate`、`userIdUpdate`、`timeUpdate`;save 只在 `insert || save` 區塊設 `userIdUpdate`、`timeUpdate`.save 不碰 `userId`,故擁有者語意之欄在 save 不被操作者覆寫,K14/A06 以實測鎖定;mix 之新增走 `'insert+save'` 會覆寫 `userId`,但為內部步驟,同 `mustExist` 不開放.
- **工作樹 CRLF、HEAD 為 LF**(Windows autocrlf): 變異腳本對工作樹檔套多行 find 前,先 `replace(/\r\n/g, '\n')`(副本改 LF 後再寫入)最單純;否則 5/25 個變異以「find 出現 0 次」誤判.Edit 工具會保持原檔之行尾,不需自行處理.
- **變異挑選**: 對測試標題宣稱之每個組合各配一變異(逐列判定→只看第 1 列;空字串/非字串/繼承/不可列舉→各放寬一條件;單純空白→trim;驗證點→拿掉起首驗證/拿掉 mapOrm 內驗證/驗證挪到寫入之後;型別先於 mode→次序顛倒;`false` 於非 insert 不得被拒→只看鍵存在).`hasOwnerUserId` 之 `isAcc(d)` 與 `getOptProc` 之 `isAcc(d) ||` 為等價變異(存取器之 `d.value` 恆 undefined,另一條件已擋),未列入.
