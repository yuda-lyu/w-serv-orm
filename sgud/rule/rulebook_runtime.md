# 規則帳本(擴充函數、授權、實例、備份還原與相容)

本檔為 `rulebook.md` 之分檔(2026-10-22 依全域 §14 整理: 各節原文逐字搬移,節號與標題不變,未刪改)。索引與共通事項(系列規格、測試與 lint 指令、行號基準)見 `rulebook.md`。

## R-HOOK-01 擴充函數之註冊與呼叫契約

- 狀態: 已套(1.1.8;1.1.9 參數移除 isAdmin).
- 單一擁有者: `src/getProc.mjs` addFun(`:7`)、procOrm(`:31`).
- 規則:
  1. 屬於各實例;註冊須為函數,否則註冊時拋 Error(addFunCheck 另見 R-ERR-01 規則 4).
  2. 註冊後約 1 ms(setTimeout)才生效,沿用既有時序.
  3. 呼叫順序:
     - check: 以 pmSeries 依序呼叫;reject 或拋錯即擋下,回傳值不影響結果.
     - 前處理: 逐一呼叫;回傳須為含 input 之物件,否則 reject.
     - mapOrm.
     - 後處理: 逐一呼叫;output 為前一個之回傳值.
     - 迭代前取快照,呼叫進行中才註冊者不套用於該次呼叫.
  4. 各函數收到新建之參數物件: check、前處理為 `{woName, userId, mode, input}`;後處理另含 `output`.
  5. 後處理之 input 為前處理後之 input(無前處理者即呼叫端傳入者),不含本套件之補值與 R-ID-02 之轉型;output 為 mapOrm 之回報(含補出與轉型後之主鍵).1.1.10 之前之 JSDoc 與本條原寫「呼叫端傳入者」,與 `src/getProc.mjs` 之前處理迴圈(input 依序被前處理之回傳取代)不符,1.1.10 之後更正.
- 測試: `test/unit-WServOrm.test.mjs` I05、I06、I08、I09、K01-K07、H01.
- 變更紀錄:
  - 1.1.8: 前、後處理改為逐一呼叫並取快照(原以 pmChain 串接,多個後處理時回 undefined);註冊須為函數.
  - 1.1.9: 參數移除 isAdmin.

## R-AUTH-01 procOrm 不做授權

- 狀態: 已套(1.1.9;getProc 之檢查於 1.1.9 之後補齊).
- 單一擁有者: `src/checkOptRemoved.mjs`(`:4`).收 opt 之進入點皆呼叫: WServOrm(`src/WServOrm.mjs:106`,於建構最前)、getProc(`src/getProc.mjs:70`).亦供使用端包裝層以其自身之 opt 直接呼叫(只看三鍵,其他鍵不受影響),見 R-COMPAT-01.
- 規則:
  1. procOrm 不檢查使用者,也不依使用者過濾數據;userId 只供寫入稽核欄位(userId、userIdUpdate)與交給擴充函數.
  2. useCheckUser、getUserById、useExcludeWhenNotAdmin 已移除.未給、null、false 接受;其餘值拋 Error,不靜默忽略.直接呼叫 getProc 者亦同,訊息與 WServOrm 相同.
  3. WServOrm 之檢查須早於建立各資料表 ORM(`src/WServOrm.mjs:106` 先於 `:109` getWoItems).否則拋錯時已開啟之 ORM(如 lmdb 之檔案)無從關閉.WServOrm 再把 opt 交給 getProc(`:117`),重複檢查無副作用.
  4. procOrm 開放給前端時,授權由開放處負責.本套件文件只寫「由開放處負責」,不寫死他套件之選項名(w-serv-webdata、w-serv-hapi 與本套件互不依賴).
- 依據:
  - useCheckUser 只查使用者存在且啟用,是認證不是授權,曾被 w-web-api 之 ADR-022 當成 ORM 層授權.
  - useExcludeWhenNotAdmin 依賴只有 useCheckUser 才產生之 isAdmin,關閉 useCheckUser 時會把所有人當非管理者過濾.
  - procOrm 同時被使用端之伺服端程式與資料通道以相同參數呼叫,在 procOrm 分不出來源.
  - 業主 2026-10-12 決定授權放在資料通道.
- 盤點指令: Grep `src/`、`test/` 搜 `useCheckUser|getUserById|useExcludeWhenNotAdmin|isAdmin`;命中只應為 `src/checkOptRemoved.mjs`、WServOrm 之 JSDoc,以及專測已移除設定之 I03、I04、I08、I12、I13.其餘測試照文件用法不傳 opt.
- 測試: `test/unit-WServOrm.test.mjs` I03、I04、I08、I12、I13.
- 變更紀錄:
  - 1.1.9(2026-10-13).原預設 useCheckUser 為 true,未給 getUserById 時 procOrm 一律 reject;現未給 opt 即正常執行.
  - 1.1.9 之後(2026-10-13): 檢查抽為 `src/checkOptRemoved.mjs`,getProc 亦呼叫.1.1.9 之 getProc 只收 mapOrm,直接呼叫而傳入已移除設定者(w-web-sso 之 `spec/evidence/2026-10-12-usecheckuser-write-paths.mjs:35` 傳 `useCheckUser:true`)被靜默忽略.本套件測試原有 38 處仍傳 `useCheckUser:false` 等(`test/unit-WServOrm.test.mjs` 35 處、`test/unit-mapOrm.test.mjs` 2 處、`test/api-procOrm.test.mjs` 1 處),改為不傳.

## R-INST-01 同一行程內之多個實例互不干擾

- 狀態: 已套(1.1.8).
- 單一擁有者: `src/getMapOrm.mjs` getMapOrm(`:901`)、`src/getProc.mjs` getProc(`:65`).
- 規則:
  1. 不得有可變之模組層狀態.
  2. getMapOrm 每次回傳綁定 ds 與 woItems 之新函數,參數形狀維持 `(userId, woName, mode, input)`.
  3. getProc 每次建立實例狀態 st.
  4. 回傳之函數不依賴 this,可解構後當裸函數傳遞.
- 盤點指令: Grep `src/` 搜 `^let |^var |^const `.
- 站點全集與判準(2026-10-17 補 const): `src/getMapOrm.mjs:118`(MSGS_BAD_KEY,`Object.freeze` 之訊息常數)、`:128`(MAX_DEPTH_FIND,數字常數),皆不變: 非狀態.原有: `src/getSettings.mjs:9`、`src/getDb.mjs:16`(`fdSrv`,模組載入時之 cwd,不變): 刻意;`src/getDb.mjs:160`、`src/getDbBackupAndRecover.mjs:109`(匯出物件): 非狀態.
- 測試: `test/unit-WServOrm.test.mjs` I01、I02、I05-I07、I09-I11.
- 變更紀錄: 1.1.8(原 getMapOrm 為模組單例,後建之實例會覆寫先建者).

## R-DB-01 備份與還原: 失敗必 reject,還原前先驗內容

- 狀態: 已套(1.1.8).
- 單一擁有者: `src/getDb.mjs` backup(`:69`)、recover(`:111`);`src/getDbBackupAndRecover.mjs` backup(`:17`)、recover(`:40`).
- 規則:
  1. 失敗時印 log 後 reject 原錯誤,不吞錯;未 await 之頂層腳本亦以非零離開碼結束.
  2. backup:
     - woItems 須為非空物件.
     - o2j 無法序列化(回空字串)即 reject,不寫出空檔.
     - 輸出至模組載入時之 cwd 下 `backup-<時間>.json`.
  3. recover:
     - 檔案須存在,woItems 須為非空物件.
     - 內容須為非空陣列,各筆 name 為字串且為 woItems 之**自有屬性**(Object.prototype.hasOwnProperty;原以 wsemi haskey 即 `in`,`constructor`、`toString` 等原型鏈名稱通過驗證,前面之表寫入後才以 TypeError 失敗而部分還原,外審 opus 二輪 F9,2026-10-17 修);於任何寫入之前驗證.
     - 以 insert 還原(主鍵已存在即略過),故資料表須先清空.
  4. getDb.recover 之 bRela 須提供 opt.ds 與 opt.genModelsByTabs.
  5. 低階 recover 之參數為 `(fp, woItems, genModels, needCreateStorage)`,getDb.recover 為 `(woItems, fp, opt)`,順序不同(既有,不改).
- 已知限制:
  - 同一秒內兩次 backup,檔名相同而覆寫.
  - 輸出目錄固定為 cwd.
  - 逐表寫入中途失敗時,先前之表已寫入.
  - 觀察(2026-10-17 外審 sol 實跑,主控裁示不修): `src/getDbBackupAndRecover.mjs:99` 之 `size(v.data)` 對格式外之物件型 `data`(如 `data:{id:'a',length:0}`)為 `length` 之值(0)而不呼叫 insert,靜默略過該表;備份檔由 backup 產生,`data` 恆為 select 之列陣列,屬營運者備份檔路徑、格式外輸入.
- 測試: `test/unit-getDb.test.mjs` B01-B12、B04b(備份之 name 為原型鏈名稱即於寫入前 reject).
- 變更紀錄: 1.1.8(原 getDb 吞錯、bRela 必失敗、壞檔或空陣列假成功).

## R-COMPAT-01 已發布之 src 路徑視為公開介面;使用端皆為自有套件,不留相容檔

- 狀態: 已套.
- 規則:
  1. 使用端以深層路徑引用 `w-serv-orm/src/*`.刪除、改名或改變匯出、參數、錯誤型別前,須盤點使用端之全部深層引用,含根目錄之 g_ 腳本、測試(含 `test/tools/`)與 spec 之取證腳本.
  2. 使用端皆為自有套件,不保留轉出之相容檔,也不為相容而靜默接受已移除之參數(業主 2026-10-13 指示: 一律改到好,避免殘留).做法: 本套件直接改;使用端仍引用者,寫 `./建議<套件>調整.md` 交業主轉主責 agent.
  3. 移除之介面若仍被傳入(如已移除之設定),拋 Error 指出替代作法,不靜默忽略.
- 盤點指令: 對四個使用端之 repo 根目錄各跑一次 Grep,glob `!**/{node_modules,dist,docs}/**`,搜 `w-serv-orm/src/`.使用端位於 `C:\opensrc\開源-JS-411-8-w-web-<名稱>\w-web-<名稱>`;是否另有使用端,讀 `C:\opensrc\*\*\package.json` 之依賴確認(2026-10-13 只有這四個).在 `C:\opensrc` 根目錄直接 Grep 會逾時.
- 站點全集(2026-10-13):
  - `src/WServOrm.mjs`: 四者之 `server/WWeb<名稱>.mjs`(sso `:25`、perm `:28`、api `:27`、task `:24`)與 g_mOrm(sso、perm、api 之 `g_mOrm.mjs:2`,task 之 `g.mOrm.mjs:2`).
  - `src/getMapOrm.mjs`: sso `test/unit-optWServOrm.test.mjs:9`、`test/tools/unitProc.mjs:6`、`spec/evidence/2026-10-12-usecheckuser-write-paths.mjs:7`、`spec/evidence/2026-10-12-tokens-insert-owner-overwrite.mjs:7`;perm `test/unit-procCore-updateTabItems.test.mjs:15`.
  - `src/getProc.mjs`: sso `test/unit-optWServOrm.test.mjs:10`(`:70` 傳 opt)、`test/tools/unitProc.mjs:7`(`:238` 傳 opt)、`spec/evidence/2026-10-12-usecheckuser-write-paths.mjs:8`(`:35` 傳 `useCheckUser:true`,1.1.9 之後拋錯).
  - `src/getDb.mjs`: sso、perm、api 之 `g_backupDb.mjs:2`.
  - `src/genTestData.mjs`: sso、perm、api 之 `g_initialTestData.mjs:3`.
  - `src/getItemsFail.mjs`: 已刪除(1.1.9 之後);引用 0 處,sso 之 `server/ormWrite.mjs:6` 已改引 w-data-collector.
  - `src/checkOptRemoved.mjs`(1.1.9 之後新增): 引用 0 處.2026-10-13 之建議檔建議 api、perm、task 於包裝層呼叫,以免移除讀取三鍵後部署設定被靜默忽略;採用後列入本清單.
- 測試: `test/unit-WServOrm.test.mjs` I07(直接呼叫 getMapOrm)、I12(直接呼叫 getProc)、I13(單獨呼叫 checkOptRemoved).
- 變更紀錄:
  - 1.1.8 開發時曾刪除 `src/getItemsFail.mjs`,經複審發現 w-web-sso 以深層路徑引用而改為轉出之相容檔.
  - 1.1.9 之後(2026-10-13): 刪除該相容檔與其測試 K08;規則 2、3 依業主指示訂定.原盤點指令之 glob(`**/w-web-*/{server,src,test}/*.mjs`)漏掉 g_ 腳本、`test/tools/` 與 `spec/evidence/`,已改.
