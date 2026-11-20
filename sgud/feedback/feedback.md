# 回饋(feedback)

任務中發現之自有套件、全域技能、全域設定之調整與抽提提案.只增不改:處置結果(已通報、已修、不採納)另記一列並寫明承接哪一列.回饋是紀錄與提案,實際修改走全域設定 §5.2、§13 之通報管道.

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-20 | 自有套件 | w-orm-lowdb | 1.0.72(npm 最新版)對**繼承之字串 id** 之列(`Object.create({ id: 'a9' })`)`insert`、`save` 皆回成功,而表內寫入一筆**不含 id 欄**之列(後端 cloneDeep 保留原型,`v.id` 讀得原型上之字串而通過主鍵檢核,序列化只含自有鍵);繼承之數字 id 同情形則已拒絕(第 557 項).建議於檢核時以自有屬性判定主鍵,或對此類列補主鍵/拒絕,避免庫內出現無主鍵之列.下游 w-serv-orm 因複製列時只取自有可列舉鍵而不受影響(本庫 `test/api-objcopy.test.mjs` A27 之繼承 id 段). | 直呼 `wo.insert([Object.assign(Object.create({ id: 'a9' }), { name: 'n3' })])` 回 `{ n: 1, ok: 1 }`,隨後 `select()` 含一列 `{ name: 'n3' }`(1.0.72 實測;`save` 同,回 `[{ ok: 1 }]`);w-orm-lowdb 第 557 項報告已列為範圍外觀察(行為不變) |
| 2026-11-20 | 自有套件 | w-orm-lowdb | 承上列(繼承之字串 id 寫入無 id 欄之列)之處置結果: 1.0.73(第 569 項)已改為主鍵只認自有可列舉之資料屬性,繼承(字串、數字、物件、類別 getter、frozen 原型)與自有不可列舉者皆視為未帶而補新主鍵,與本庫 R-OBJ-01 規則 7 ① 同口徑;本庫 `api-objcopy` A27、A27b 之繼承 id 案已放回以直呼為預言機.無新建議. | 暫存探針(已清除)12 形態 × insert、save 加 del 2 格共 26 格,直呼與經 procOrm 之表內容全同(1.0.73 實測);`node_modules/w-orm-lowdb/README.md` 〈Breaking changes〉「改為『未帶』(主鍵只認自有可列舉之資料屬性)」條 |
| 2026-11-20 | 自有套件 | wsemi `clearXSS` | `clearXSS(new String('a'))` 回**原始字串** `'a'`(`typeof` 為 string):`clearXSS` 屬轉換函數,依 dspec §11 W-20「轉型函數照舊拆包」可接受,但呼叫端若在其**之前**以判斷函數(`isestr` 等,包裝物件為 false)守門、之後才複製,包裝物件會被拆成原始值而繞過守門之意圖(本庫第 568 項之 `new String('a')` 當主鍵寫入即此形狀).建議 wsemi 於 `clearXSS` JSDoc 明寫「String 包裝物件會被拆為原始字串」,供使用端排序檢查與複製之先後(本庫已於複製之前檢查,無須改 wsemi 行為). | 本庫 `tmp/osv568/probe-ids.mjs` 修前實測 `procOrm('insert', [{ id: new String('a') }])` 寫入主鍵 `'a'`;`node` 直呼 `clearXSS(new String('a'))` → `typeof` string(wsemi 1.9.70) |
| 2026-11-20 | 全域技能 | role-coder-for-test | §1 第 6 點(單一規則集中為單一包裝再套多呼叫點須逐點接線與變異)之實作,本輪以「同一判定函數 `getItemsBadId` 套到 insert/save 與 mix 之 add、diff 三站」驗證可行: 逐站變異(M1、M2a、M2b)各由不同測試擊殺;另補一條可抽成技能之做法:**以 `git archive HEAD` 解出舊 src 副本於 `./tmp/`、複製新測試入副本、以 `--cwd` 跑,取得「修前紅」之可重跑證據**(含需 `path.resolve('./src')` 之靜態掃描測試,cwd 須為副本).建議將此作法補入 §1 或 §7 之範例. | 本輪 `tmp/quiet-run` 之 red2 log(29 案紅) |
