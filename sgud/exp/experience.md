# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

> **2026-10-22 整理**:2026-10-11～17 之經驗(16 節,20 節中標題日期在 2026-10-17 以前者)已抽出至 `experience_20261022.md`,原文逐字搬移、節號與標題不變;需要久遠經驗時再調閱。本檔留 2026-10-19 起之經驗。

> **2026-10-29 整理**:2026-10-19～23 之經驗(9 節:第 33 項批 3 至 orm-run05)已抽出至 `experience_20261029.md`,原文逐字搬移、節號與標題不變。本檔留 2026-10-28 起之經驗。

## orm-run01(2026-10-28 派工,新 session): 診斷輸出不得含資料值(R-DIAG-01)

規則見 `rulebook_diag.md` R-DIAG-01(含 72 站全集).以下只記往後會再用到的經驗.

- **「console 診斷」要整個 `src/` 盤,不只建議書列的行**: 建議書只列 `getMapOrm.mjs` 之 8 站,實盤 72 站,其中 `getSettings.mjs` 傾印整份設定(含 `dbPassword`)、`genTestData` 預設印整批資料列、`getDb` 之 `console.log(err)` 印含 ORM 回傳原文之 Error,皆同型.盤法: 逐行去註解後依檔計次(`unit-diaglog` S01),新增站點即失敗而被迫歸類;計次比行號穩.
- **單一出口 `diag(label, safe, getDetail)`**: 每個站點同時給「安全摘要」與「完整細節(thunk)」,預設輸出摘要、`logDetail` 輸出細節、`funLog` 收三者.細節用 thunk 是因為快照(`snapSafe`)與 `e.toString()` 只有在有消費者時才該計算.摘要與細節在站點旁成對寫,審查時一眼可核對「預設不含 id」.
- **摘要的錯誤類別用白名單樣式,不信任 `name`/`code` 的內容**: `err.name` 是使用端可改的字串,`code` 可能夾帶主鍵;類別名稱 `^[A-Za-z][A-Za-z0-9_]{0,39}$`、代碼 `^[A-Z0-9_]{1,40}$`、數字限有限數.驅動程式錯誤常以原型上的存取器宣告 `name`(MongoServerError),只讀資料屬性會讀不到,故先取建構子名稱再取 `name`.全程用 `util.types` 與屬性描述子,Proxy 與 getter 不執行(O07).
- **斷言失敗時的格式化也要小心**: 變異 M02 令摘要誤含原錯誤物件(含 Proxy),`assert.deepStrictEqual` 失敗時格式化差異會觸發 Proxy 陷阱,mocha 行程以離開碼 0 靜默結束,變異腳本讀不到「N failing」而誤判存活.測試對「可能含不可信物件」的實得值,先轉為純資料(`JSON.parse(JSON.stringify())` 包 try)再比對;變異腳本對讀不到統計者要印尾端輸出,不要預設 0 紅.`spawnSync` 要加大 `maxBuffer`.
- **舊測試把「原文進 log」當預設**: U19d、U22、N11、T01、P06、D07b 等 7 案隨預設改變而紅,不是放寬而是規格改變: 改以 `logDetail: true` 取得舊輸出並保留「reject 不含原文」之斷言,另以新測試鎖預設.`unit-objcopy` 以 `getKinds()` 單點改為 `logDetail: true`,因其 D07/D07b/C03/S14 驗證的正是「快照輸出不執行使用端程式」,預設不輸出快照時這些案會空轉通過.
- **修前紅用 HEAD 副本跑最終測試**: `git archive HEAD src schema package.json` 與 `test/tools` 解到 `tmp/orm-run01/head/`,把最終的新測試檔複製進去,以 `node <repo>/node_modules/mocha/bin/mocha.js` 在該夾跑(不要 `npx`,該夾有 package.json 會嘗試另裝);比「先寫測試再跑舊碼」可靠,因為測試後來又改過(如 P24 的 `<b>` 實際不會被 clearXSS 改寫,首次紅是錯的原因).
- **真實 stdout 要用子行程驗**: 單元測試以替換 `console.log` 擷取,驗不到「行程標準輸出」;`api-diaglog` 以子行程實跑真 w-orm-lowdb(外包一層只讓特定 id 失敗),父行程檢查子行程之 stdout/stderr 位元組,並以 `logDetail` 為正對照.
- **工具路徑的選項型別慣例與建構路徑不同**: `getDb`、`genTestData`、`getSettings` 之 `bLog` 型別錯誤是忽略並用預設,故 `logDetail`/`funLog` 在這些處同樣忽略(`getOptLogLoose`);`WServOrm` 建構是拋 `Error`(`getOptLog`).兩者預設值皆為安全輸出,忽略不致洩漏.
- **外審 terra 第一輪找出 18 項,核實後修了 15 項**(報告留在任務資料夾 `agent-out/orm-run01-evidence/04-review-terra-round1.md`): 我自審時判「不需改」的 18 站(無效參數值、表名、路徑、固定 Error)被指出 `funLog` 給定時仍有直接 console 且傳入值可含帳密,最後改為 72 站全數經 diag,不變式簡化為「除 diag 本體外 `src/` 無 console」,比「逐站分類」好守.教訓: 「這個輸出只是設定值/路徑/固定句,不含資料」的判斷最容易漏,因為值是呼叫端給的.派外審時提示詞要寫明驗收條件與讀檔法、副本內字樣中性化(「注入」「繞過」等改寫),terra max 約 8 分鐘讀完整個套件.
- **診斷輸出的五個「不得影響結果」陷阱**(皆由外審發現,各有測試): (1) 交給 logger 的物件若與組 reject 訊息共用,原地遮罩會改變 reject → 交拷貝、先組訊息再輸出; (2) `e.toString()` 由立即求值改延後求值,會讓拋出 null 之類的邊界從 `failed to process input` 變成 `failed to adjust data` → 維持立即求值; (3) 摘要再讀一次 `ok`、`length` 等屬性,getter 可前後不同或拋錯 → 摘要不重讀、只用描述子與固定常數; (4) 原生 promise 的 `then` 屬性可被覆寫成拋錯的 getter → 用 `Promise.prototype.then.call`; (5) 建構選項讀兩次,getter 可前後不同 → 讀一次、傳固定快照.
- **斷言失敗時格式化實得值也可能拋錯而讓測試行程靜默結束(離開碼 0)**: 實得值含 Proxy 或帶 throwing getter 的物件時(變異使摘要誤含原物件),`assert.deepStrictEqual` 的差異格式化會觸發陷阱.凡實得值可能含不可信物件,先 `JSON.parse(JSON.stringify())` 轉純資料再比對;變異腳本對讀不到統計者標「未判定」不得當作存活或殺死.
- **以 HEAD 實跑確認路徑表的預期值是舊版行為**: 把最終測試複製進 `tmp/orm-run01/head/test/`,補一份 `getDiag.mjs` 讓 import 通過,只跑契約類案(`--grep "C01|C02|O11"`)在 HEAD 全綠,即證明「reject 預期值=舊版行為」,這是契約不變的獨立預言機(C01 本身只比新版各選項,不夠).
- **「拷貝細節」越做越深是陷阱,改成「只用內建操作 + 標記」才收斂**: 外審第二至四輪對 `cpDetail` 逐輪找出 Date 實例方法、`stack` 存取器、Buffer 共用/型別轉換、`structuredClone` 對 SharedArrayBuffer 視圖與小視圖大緩衝區、RegExp 自有 getter、寬/稀疏陣列、非索引鍵等邊界.根因是我試圖「複製所有東西並保真」.最後的政策: 只複製純物件/類別實例/陣列/Error/Date/Map/Set(全用內建方法),其餘(函數、Proxy、RegExp、二進位、Promise…)一律標記字串,存取器以 `[Getter/Setter]` 保留鍵,預算同時計節點與鍵.logDetail 因而對這些值輸出標記而非原值——這是明示的取捨,比保真但有洞好.往後遇到「要把使用端物件交給外部函式又不能被改動」,先決定哪些型別值得保真,其餘標記.
- **外審不會自己收斂**: 四輪各 18/15/7/6 項,後兩輪幾乎都是對「前一輪新寫的防護」的邊界.收斂靠主責決策(縮小範圍、寫入已知限制、說明哪些修正未再送審),不是靠等審查者說通過.每輪回覆前先分類: 屬實且影響預設行為/契約(修)、屬實但病態構造(修或列限制)、與驗收條件衝突(不採納並寫理由).
- **同系列只讀調查的結論(未改檔)**: 7 個 `w-orm-*` 與 `w-serv-webdata` 之 `src/` 無 A 類(資料列、主鍵)站點;各 ORM 的 `emitChange`/`emitError` catch 內 `console.log(例外)` 印使用端訂閱函數拋出的例外,屬弱 B 類;`w-orm-reladb` `WOrmReladb.mjs:558` 重複輸出 `importModels` 失敗結果.`w-serv-webdata` 把 procOrm 的 reject 值原樣回給前端(文件載明之設計),故 procOrm 的 reject 訊息(逐筆失敗列主鍵,R-MSG-01)仍會到前端——本輪不動(契約).

## tm-servorm(2026-10-29 派工,新 session): 計時器測試改以事件同步(R-TRACE-01)

規則與處理清單見 `rulebook_timer.md`;規格 `C:\opensrcOper\dspec\計時器相關函數之觀察回調與測試.md`.以下只記往後會再用到的經驗.

- **盤點表只是起點,要以「站點全集」重盤**: timer-inv01 明細表列本套件 C 類 13 案、(d) 5 案;讀碼後以 `addFun*` 為軸(Grep 全部 37 處註冊)得 C 類 20 案(多出 I06、I09、K06、K07、L05、D03、N09,同為註冊後固定 `wait`),(d) 6 案(多出 S04:時間量測包在輔助函式 `elapsed`,`Date.now() - t` 的 Grep 看不到).盤法: 先找「被測物的計時器」(`src/` 內唯一一處 `setTimeout`),再反查所有等它的測試站點,不從測試端的等待字串往回找.
- **基準 0 失敗是預期,不是白改**: 本套件 C 類案等的是 1ms 生效計時器,而測試用 `wait(5)`/`wait(20)`;Node 於同一輪事件迴圈建立之計時器依到期時間排序,5ms 者必在 1ms 者之後,故 8 壓力行程、事件迴圈阻塞 400:1000、重度阻塞 1500:3000 下改造前皆 0 失敗(25 次 x 339 案).改造的價值是去掉對「計時器排序實作細節與延遲長短」的依賴: 變異 P01(生效延遲 1ms 改 40ms,非缺陷)舊測試 16 案轉紅、新測試 0;案耗時縮短(例 I09 47→15ms).往後遇到「等自有短計時器」類,先預期基準不會紅,改善證據走「變異 + 耗時 + 設計去除假設」(規格 P7 已載)。
- **註冊失敗之否定觀察用屏障,不用等待**: 要證明「註冊非函數不留下任何排程」,在其後註冊一個無作用 check 並等其 `active` 事件(`test/tools/hookKit.mjs` `settle`);同為 1ms 計時器依註冊先後觸發,屏障到時先前排定者必已生效或確定不會生效.屏障的前提是計時器同時長依序觸發,若日後生效延遲改為不等長須重審.
- **「呼叫進行中」步間改等被測函數自身進入**: I09、K05 原以 `wait(5)` 等呼叫進入 check/後處理,改為擴充函數內 `enter()` 解開 Promise(因果同步),比等時間強.
- **效能時限類改 CPU 時間斷言,但要知道其限制**: `process.cpuUsage` 於 Windows 粒度約 15.6ms(小值呈 0 或 16)、含 GC 等所有執行緒故可大於牆鐘(S13 實測 CPU 376 / 牆鐘 303);量測區間只能含微任務,若跨過會跑他人回呼之巨任務(如負載試驗的事件迴圈阻塞回呼)則同行程他人的 CPU 亦計入.偵測力以變異驗證: 燒 CPU 之變異新舊測試皆紅,`Atomics.wait` 阻塞(不耗 CPU,模擬被擱置)只有舊的牆鐘測試紅.裕度 S13 20 萬層僅 2.7 倍(建鏈本身耗 CPU),其餘 16~62 倍.
- **整批變異的 `--grep` 要先驗證選到了新案**: 原 grep 寫 `(…|HT0|HT1)[ b]`,但案號 `HT01 ` 在 `HT0` 之後接的是 `1` 而非空白,新增的 HT 案全沒被選入(對照組只有 30 案而非 41);改 `HT[0-9][0-9]` 補跑.對照組案數與預期不符時先查選取式.
- **鎖排隊是本輪最大成本**: 他套件的負載試驗以獨佔鎖串成 40~60 分鐘的長鏈,`--lock-exclusive` 搶鎖是競爭而非先進先出,有獨佔者排隊時一般 `--lock` 不取新槽(含自己的獨佔請求在排隊時).對策: (1) 開工第一件事就把改造前基準丟進佇列,排隊期間只寫碼、不跑測試;(2) 之後把「改動測試 -> eslint -> 全套 -> 改造前測試對新 src -> 變異 -> 負載試驗」合併為**單一**獨佔鎖內的腳本(`tmp/tm-servorm/session.mjs`),第一步失敗即停以釋放鎖;(3) 獨佔鎖內**不可**再呼叫 `quiet-run --lock-exclusive`(巢狀會與自己死結),直接呼叫 `loadTrial.mjs`;(4) 腳本於取得鎖時才載入,故排隊期間仍可修改其步驟.
- **全域技能於執行中被同步更新**: 開工時 `role-coder-for-test` 尚無 §8 與 `references/timer-tests.md`,第 3 小時才出現;以 dspec 為準開工,收尾前補讀細則核對(五種回調案、變異對照舊測試、負載試驗次數 8~10 次;本輪後測為 6/6/5,因排隊耗時,前測為 10/10/5).

## mig-servorm(2026-10-29 派工,新 session): 診斷輸出遷移至 wsemi 共用模組(R-DIAG-01)

- **wsemi 之 safe 正規化只收純物件**: 舊站點以字串(`diag('backup...', k)`)或陣列(`[...msgsBadKey]`)當 safe,遷移後整個摘要靜默消失(預設輸出只剩標籤).遷移時先 Grep 全部 `diag(` 之第 2 引數,非物件者改為 `{ table }`、`{ msgs }` 並宣告於 `safeKeys`;S04 之語法白名單同步改,變異 M27 以 T03 之 `{ table }` 斷言殺死.
- **秘密來源之分類決定 reject 清單**: `getDiagSecrets({ urls: [url] })` 把「網址整串」列入 reject 清單(長度 ≥3,不需 `://`),lowdb/lmdb 之 url 是檔案位置,會使對外錯誤值之路徑被遮而違反 Q3;改以 `getUrlSecrets`(含 `://` 或 `@` 者為 urls,其餘為 paths).測試替身之 url `'url'`(3 字元)亦成為 detail 清單之秘密,細節中凡含 `url` 子字串者都被遮——寫細節斷言時避開此字樣,或用語料之 `secrets().url`.
- **整串網址是秘密時,訊息中的網址整段成 `***`**(不是 `scheme://***@host`);只有未登錄之網址才走帳密樣式.斷言以結構(前綴原樣、不含密碼、含 `***`)寫,不要猜遮罩後之逐字結果.
- **「throw 訊息經 diag.mask」要收窄到外來段**: 工具路徑之訊息為「固定前綴＋表名＋ORM 原文」,整句遮罩會在密碼為前綴子字串時挖空固定詞彙(反推密碼).以密碼 `data`(4 字元,入 reject 清單;是 `failed to save data`、`failed to recover data into table` 等的子字串)驗證固定詞彙原樣,變異「整句 diag.mask」(M17)即被殺.同理擴充函數之守門訊息要排除(密碼 `function`).
- **修前紅用 HEAD 副本**: `git archive HEAD src test schema package.json | tar -x -C tmp/<輪>/head`,再把新測試複製進去;副本內 `import 'wsemi/...'` 依 Node 之上溯解析到 repo 之 `node_modules`,不需連結.mocha 以 `node <repo>/node_modules/mocha/bin/mocha.js` 執行(副本有 package.json 而無 node_modules,`npx` 可能去下載),quiet-run 用 `--cwd` 與 `--log`.`--no-parallel` 時任一檔 import 失敗(如新模組在 HEAD 不存在)會使整批不跑,該檔另跑或改為只 import 公開模組.
- **變異在副本上做**: 腳本每個變異重新複製 src 至 `tmp/<輪>/mut` 後套用(字串須恰好命中),跑完刪副本;repo 之 src 全程不動,腳本中途失敗也不會留下變異碼.單一 `--lock` 內跑完全部變異(28 個約 3 分鐘).
- **鎖等待**: 本輪每次 `--lock` 排隊 4～7 分鐘(他套件同時遷移),把「受影響之測試」合併為一次、變異合併為一次、全套一次,其餘時間寫文件.
