# 規則帳本: 診斷輸出(console)與對外錯誤值之遮罩

本檔收 R-DIAG-01、R-DIAG-02. 通則與其他規則見 `rulebook.md` 之分檔索引.

## R-DIAG-01 診斷輸出不得含資料值: 預設只輸出標籤與摘要,完整細節由 `opt.logDetail` 或 `opt.funLog` 取得

- **依據(2026-10-29 mig-servorm 起)**: 跨套件規格 `C:\opensrcOper\dspec\診斷輸出與遮罩.md`(原則 D1～D5、裁定 Q1～Q4 與 P1～P9;本套件之列見其 §4)與 wsemi 之規則帳本 R-DIAG-01(來源 repo `C:\opensrc\開源-JS-002-3-wsemi\wsemi\sgud\rule\rulebook_diag.md`;實作 `wsemi/src/getDiag.mjs`、`getDiagSecrets.mjs`、`maskDiagText.mjs`、`maskDiagCopy.mjs`、`maskDiagErr.mjs`、`getDiagBriefErr.mjs` 等,**各函數之 JSDoc 為用法之準**).本節只記本套件之宣告、站點與測試;遮罩、拷貝、摘要、出口之規則不在此重述.
- 狀態: 已套(2026-10-29 mig-servorm,未提交、未發布;wsemi ^1.9.31).前身: 2026-10-28 orm-run01 之自寫 `src/getDiag.mjs`(來源 w-web-perm 建議書 Gitea #12),本輪刪除.
- 單一擁有者:
  - 出口與遮罩: wsemi(本套件不得另寫等價實作,dspec D1).
  - 本套件之宣告: `src/getDiagBrief.mjs` 之 `genDiag(opt, secrets)`(唯一呼叫 wsemi `getDiag` 處;宣告 `codes`=`sqlstate sqlite mysql mssql mongo mongoServer lmdb level`、`nested`=`original parent`、`safeKeys`=公開之 `SAFE_KEYS`〔`src/safeKeys.mjs`,見 R-DIAG-02〕).連線位址之秘密由呼叫點(`WServOrm.mjs`、`getWoItems.mjs`)以 wsemi `getDiagSecrets({ conns: [url] })` 導出(含 `://` 或 `@` 者為連線字串,同 `urls`;其餘〔lowdb、lmdb 等之檔案位置〕為儲存路徑,同 `paths`,只遮診斷輸出,對外錯誤值不遮,dspec Q3;原 `getUrlSecrets` 於 2026-10-30 刪除).
  - 本套件語意之摘要: 同檔之 `getBriefFails`、`getBriefResult`、`getBriefType`、`getBriefCount`(Proxy 判定用 wsemi 公開之 `isProxy`,描述子與自有鍵用內建 `Object.getOwnPropertyDescriptor`、`Object.prototype.hasOwnProperty.call`,不匯入 wsemi 底線內部檔,不靜態 import `util`).
  - 選項型別檢核: `WServOrm` 建構子之 `getOptLog`(`logDetail` 非布林、`funLog` 非函數拋 `Error`;各讀一次,以快照交 `genDiag`).工具路徑(`getDb`、`genTestData`、`getSettings`)與直接使用 `getMapOrm` 者把 `opt` 交 wsemi(型別不合者為預設,同 `bLog`).
- 規則(本套件之接線):
  1. **出口**: `src/` 內一切診斷輸出經 wsemi 之 diag(無直接 `console`,站點全集 66 個 `diag(` 呼叫,依檔: `getMapOrm` 43、`getDb` 8、`getDbBackupAndRecover` 7、`getWoItems` 4、`genTestData` 2、`getSettings` 2);**全部不帶 level**(舊版皆 `console.log`,串流不變);`bare` 已刪除(logDetail 之輸出一律 `console.log(標籤, 細節)`).每個 `WServOrm` 實例一個 diag,`getWoItems`、`getMapOrm`、`getProc`、實例上之 `backup`/`recover`、`closeAll` 共用.
  2. **秘密**: `WServOrm`、`getWoItems`(未給 diag 時)為 `getDiagSecrets({ conns: [url] })`;`getSettings` 為**函數形式** `() => getDiagSecrets({ urls: [st.dbUrl, st.url], username: st.dbUsername, password: st.dbPassword })`(讀設定檔之後才有;每次輸出時由當下之 `st` 導出);`getDb`、`genTestData`、低階 `backup`/`recover` 未給 diag 者無登錄之秘密(只依 wsemi 之網址帳密、憑證鍵值對、Bearer 樣式).
  3. **safe**: 只用 `safeKeys` 之鍵(其餘由 wsemi 丟棄);值為固定詞彙、計數、位置、表名(woItems 自有鍵)、型別名.進度為 `{ table }`,固定句型訊息為 `{ msgs: [...] }`.
  4. **細節**: getDetail 回傳原值即可(wsemi 一律 `maskDiagCopy`);被拒條件(find)之細節為本層 `snapSafe` 之快照再經拷貝.
  5. **對外錯誤值(dspec D3、§6.5)**: 外來值於 catch 站點經 `diag.err`(站點見下表「外來值」15 列);以固定詞彙組成之 reject 與 throw 不包(下表各「固定詞彙」列);工具路徑之失敗訊息只對其中 ORM 回傳原文(含逐筆 `err`)之段經 `diag.mask`(4 列);擴充函數守門之固定訊息(`addFunCheck needs a function, but got ...`)以 `GUARD_MSGS` 排除.**`procOrm` 之 ORM 錯誤本即只以固定字串轉出(R-ERR-01),getMapOrm 無 `diag.err`.**
  6. **結果物件之逐筆 err**: `procOrm` 之 resolve 只含 `id`,無逐筆 err(不適用);逐筆 err 只出現於工具路徑之 Error 訊息(規則 5 之 `diag.mask`)與診斷細節(規則 4 之拷貝).'error' 事件: 本套件不發出(不適用).
- 盤點指令(可重跑): 以 Grep 工具搜(腳本副本 `C:\opensrcOper\dnow\20261029002013\agent-out\mig-servorm-evidence\sites.mjs`,於 repo 根以 `node <該檔>` 執行即輸出站點表;任務歸檔後移至 `dhist\`)`src/*.mjs` 之 `\bdiag\(|diag\.err\(|diag\.mask\(|Promise\.reject\(|\bthrow\b|\.emit\(\s*['"]error|\bconsole\b|\breject\(`,逐行排除整行註解,逐站歸類;各檔之 diag 站點數與 `diag.err`/`diag.mask` 站點數另由 `unit-diaglog` S04 與 `unit-diaglog-wire` F01 鎖定.2026-10-29 結果: **195 站,未歸類 0**: 診斷出口 66、外來值(diag.err)15、外來值之段(diag.mask)4、固定詞彙 reject 13、固定詞彙+識別字(表名/mode/typeof)reject 2、固定詞彙(變數內容皆固定句型)reject 19、固定詞彙+位置/主鍵 reject 12(R-MSG-01)、邊界 catch 之字串分支 1、固定詞彙 throw 40、固定詞彙+識別字 throw 14、固定詞彙+已遮罩之段 throw 2、拒收鍵 throw 4(含 rowsInvalid)、轉拋已處置之值 2(`getDb` 之 catch)、轉拋呼叫端資料之例外 1(`baseline.mjs:460`).完整表見報告 `C:\opensrcOper\dnow\20261029002013\agent-out\mig-servorm-修正報告.md`〈站點全集〉.
- 外來呼叫之出口(依 API × 外部呼叫;判準: 外來值離開本套件前經 diag.err,或刻意不包並附理由):
  - 經 diag.err: 擴充函數 check/前處理/後處理(`getProc.mjs`)、ORM 建構(`getWoItems.mjs`)、ORM `close`(`WServOrm.mjs` closeAll)、低階 backup 之 `select`、低階 recover 之 `readFileSync`、模型產生器、`createStorage`、`insert`、組訊息之例外(`getDbBackupAndRecover.mjs`)、`getDb.backup` 之寫檔(`getDb.mjs`)、`genTestData` 之 `funTestAndSave`、`funTest`、`save`(`ext`)與 `hookFunTestData`.
  - 轉為固定字串(外來值只進診斷細節): `procOrm` 之全部 ORM 呼叫(R-ERR-01;`unit-ormsites` 19 站)、`getSettings` 之讀檔與解析.
  - **刻意不包**: `withTabLocks` 之 `fn`、`guardWrite` 之 `read`/`write` 與其觸發之 `buildBaseline` 例外(多為 `procOrm` 之固定詞彙,須原樣供 `getRejectKey`;`baseline.mjs` 零 import 不持有 diag;為呼叫端自身提供之函數之結果交回同一呼叫端).列待裁示.
- 測試:
  - `test/unit-diaglog-wire.test.mjs`(新,接線): A 語料 wire 案 23 案之處置表(D 9、S 1、L 1、static 1、R 2、R+D 2、R-fixed 1、A 2、own 4〔R02:語料需兩個連線網址;2026-10-30 起另 A11:`genDiagFunLog` 的 `safeKeys` 以 `SAFE_KEYS` 為值;C14:pg `DatabaseError` 本套件不宣告 `types` 故 `errType` 為 `Error`;U22:`conns` 分類以語料之 url 與 path 各建一實例〕)與 C01b(本套件宣告之代碼集合);B 外來值之對外錯誤 B01-B08;C 固定詞彙原樣 C01-C03(密碼 `data`、`function`、`input` 為固定詞彙之子字串);D 逐筆 err 遮罩 D01-D04;E 串流 E01;F 站點靜態盤點 F01(各檔 `diag.err`/`diag.mask` 數).
  - `test/unit-diaglog.test.mjs`(保留為接線): 路徑表 P01-P52(getMapOrm 全部診斷站點)× 預設/logDetail/funLog;C01-C02;O01-O06、O08、O11-O16;S01-S05(S01: src 無 console、`src/getDiag.mjs` 已刪除;S04: safe 引數白名單、站點數、不帶 level).**刪除與語料重複之形態案**: O07(錯誤摘要之樣式 → 語料 C 組與 wire C01/C01b)、O09(funLog 回傳 thenable → 語料 O 組)、O10(出口本身 → 語料 O 組)、O14c(寬鬆讀 opt → 語料 O02)、O14d/e/f(細節拷貝 → 語料 K/V/E/P/S 組).
  - `test/unit-diaglog-tools.test.mjs`(工具路徑接線,T01-T18;本輪改 T02/T04/T08 之 bare、T03/T13 之 `{ table }`、T08/T11 之憑證遮罩)、`test/api-diaglog.test.mjs`(子行程之真實 stdout/stderr,A01-A06;A05/A06 改為精確斷言憑證遮罩、資料值原樣)、`test/unit-pkcast.test.mjs` N11(細節為拷貝).
  - 指令: `npx mocha --no-parallel test/unit-diaglog-wire.test.mjs test/unit-diaglog.test.mjs test/unit-diaglog-tools.test.mjs test/unit-pkcast.test.mjs test/api-diaglog.test.mjs --timeout 180000`.
- 已知限制與刻意取捨:
  1. wsemi 之已知限制全部適用(dspec §5;如 reject 清單之短密碼 <4 不遮、單獨帳號 <3 不遮、私有欄位不複製至副本、無 util 時 Proxy 不可偵測).
  2. `getMapOrm` 之邊界 catch 之字串分支原樣轉出(`return Promise.reject(e)`): 用以轉出本層之固定字串;非 async 之 ORM 方法若**同步拋出字串**,該字串亦原樣轉出(不經 diag.err).w-orm-* 之方法皆為 async(同步拋錯成為 rejection 而由 `.catch` 轉為固定字串),故只影響違約之 ORM.
  3. `getDb`、`genTestData` 與直接呼叫之低階 `backup`/`recover` 無連線網址可宣告,只依樣式遮罩(未登錄之密碼若不在網址帳密、鍵值對、Bearer 形式中則不遮);實例上之 `backup`/`recover` 依該實例之 url.
  4. 表名視為非個資(沿用 orm-run01);`errCode` 只收 wsemi 明列之集合(驅動新增之代碼須先入 wsemi 之 `_diagCodes.mjs`).
  5. 低階 recover 之 `readFileSync` 與 `getDb.backup` 之寫檔失敗之 diag.err 只有靜態盤點(F01)鎖定,無行為測試(檔案系統錯誤難以穩定觸發;變異 M07、M14 由 F01 殺死).
- 變更紀錄: 2026-10-28 orm-run01 新增(自寫 `src/getDiag.mjs`,72 站經 diag,預設摘要、`logDetail`、`funLog`).2026-10-29 mig-servorm: 遷移至 wsemi 共用模組(刪 `src/getDiag.mjs`,新 `src/getDiagBrief.mjs`;細節開始遮罩憑證、一律拷貝、不沿用原型;`bare` 刪除;safe 之 `{ table }`、`{ msgs }`;`errType`/`errCode` 依 wsemi;外來值之對外錯誤經 `diag.err`;工具路徑訊息之 ORM 原文段經 `diag.mask`).對外行為變化見 README〈Breaking changes〉.2026-10-30 a-servorm: 見 R-DIAG-02(`getUrlSecrets` 刪除、公開 `SAFE_KEYS`、不匯入 wsemi 底線內部檔).

## R-DIAG-02 本套件只用 wsemi 公開 API;safe 之鍵名單 `SAFE_KEYS` 為公開之單一來源,內容須等於各站點實際產出之鍵

- **依據(2026-10-30 a-servorm,第 198 項 A 批、排程第 187、192 項)**: 跨套件規格 `C:\opensrcOper\dspec\診斷輸出與遮罩.md` 之 D1(單一實作)、改用須知(`dhist\20261030143215\agent-out\run01-修正報告.md` §7 第 4、6 條);wsemi ≥ 1.9.33 公開 `isProxy`、`getDiagSecrets({ conns })`、`genDiagFunLog(write, { safeKeys })`.
- 狀態: 已套(2026-10-30 a-servorm,未提交、未發布).
- 規則:
  1. **不匯入 wsemi 底線內部檔**: `src/`、`toolg/`、`test/tools/` 無任何 `wsemi/src/_*` 匯入(`getDiagBrief.mjs` 之 `isProxy` 取 wsemi 公開之 `wsemi/src/isProxy.mjs`;`gd`、`hasOwn` 為內建 `Object.getOwnPropertyDescriptor`、`Object.prototype.hasOwnProperty.call` 之本地別名).測試檔唯一允許者為規格 D5 指定之共用語料 `wsemi/src/_diagCases.mjs`(`unit-diaglog-wire` 用).
  2. **`SAFE_KEYS` 單一來源且公開**: `src/safeKeys.mjs` 為零 import、只匯出 `SAFE_KEYS`(凍結之字串陣列;不列恆含之 `errType`、`errCode`、不含憑證鍵名)之公開子模組(同 `baseline.mjs` 之深層匯入慣例;下游寫法 `import { SAFE_KEYS } from 'w-serv-orm/src/safeKeys.mjs'`).`getDiagBrief.mjs` 自此取名單交 `getDiag` 之 `safeKeys`,全 `src/` 無第二份宣告;**下游不得深層匯入 `getDiagBrief.mjs` 等內部檔**.README〈公開 `SAFE_KEYS`〉寫明用途與用法.
  3. **名單內容 = 站點實際產出**: 新增或改動任一診斷站點之 safe 鍵時,須同步登錄於 `SAFE_KEYS`;漏列由 `unit-diagsafe` B2/B3 判紅(以記錄替身取得各站點**過濾前**之 safe,與名單雙向比對:漏列與從未產出皆判紅).新站點須同步加入該檔之 `SCENES` 情境(情境未驅動到之新站點,B2 無從得知;`unit-diaglog` S04 之 safe 引數語法白名單為第二道).
  4. **`getUrlSecrets` 已刪除**: 連線位址之秘密一律 `getDiagSecrets({ conns: [url] })`(wsemi 語料 U22 證明與分別給 `urls`/`paths` 相同).
- 盤點指令(可重跑): `Grep "wsemi/src/_" src toolg test/tools`(須 0 筆);`Grep "getUrlSecrets" src`(須 0 筆);`Grep "SAFE_KEYS" src`(僅 `safeKeys.mjs` 宣告、`getDiagBrief.mjs` 引用).站點全集: 診斷站點之 safe 鍵 11 個(`n ks skipped ok type reason msgs table tables keys nOther`)× 驅動情境 S1-S9(`unit-diagsafe` SCENES),各鍵之產出站點見該檔 B1.
- 測試: `test/unit-diagsafe.test.mjs`(A1-A4 公開入口〔凍結、零 import、單一來源、README 寫法與模組相符〕;B1-B4 與實際產出一致〔B3 照下游用法經 `genDiagFunLog` 轉寫逐站比對〕;C1-C2 靜態〔無底線內部檔匯入、無 `getUrlSecrets`〕)、`test/tools/diagSpy.mjs`(`getDiag` 之記錄替身)、`unit-diaglog-wire` 之 A11、C14、U22;指令: `npx mocha --no-parallel test/unit-diagsafe.test.mjs test/unit-diaglog-wire.test.mjs --timeout 180000`.
- 變異驗證(2026-10-30,每項於副本套用一處、跑 `unit-diagsafe`;對照 M0 全綠 10/10): 名單漏列任一鍵(11 鍵逐一)→ B2、B3 判紅;名單多列從未產出之鍵 → B2;站點新增產出鍵未登錄 → B2、B3;src 匯入 `_diagKit.mjs` → C1;恢復匯出 `getUrlSecrets` → C2;`getDiagBrief` 自宣告第二份 → A3;名單不凍結 → A1;`safeKeys.mjs` 帶 import → A2;修前之 src(HEAD)加新 `safeKeys.mjs` → A3、C1、C2.
- 已知限制: 下游(w-web-*)是否傳入 `SAFE_KEYS` 不在本套件可測範圍(由各下游套件之測試與第 198 項 B 批驗);非字串之無效 `url`(`WServOrm` 本即以 `invalid url` 拒收)的秘密歸類與舊 `getUrlSecrets` 略有差異(數字 `123` 舊列 reject 清單、新為儲存路徑;`String` 包裝路徑舊列 reject、新解包後為儲存路徑),屬無效輸入路徑,不列為退化.
