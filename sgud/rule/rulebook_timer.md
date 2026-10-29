# 規則帳本: 計時器相關函數之觀察回調與以事件同步之測試

本檔收 R-TRACE-01. 通則與其他規則見 `rulebook.md` 之分檔索引.

規格(單一來源,不在此重述): `C:\opensrcOper\dspec\計時器相關函數之觀察回調與測試.md`(P1 以事件同步不以時間同步、P2 斷言語意不斷言次數與時刻、P3 預設不變、P4 回調不得影響被測函數、P5 時間本身是規格者另以假時鐘、P6 真時間測試隔離、P7 負載試驗;§2 命名與事件格式).全域技能 `role-coder-for-test` 之計時器專節與細則 `references/timer-tests.md` 為其測試作法.

## R-TRACE-01 本套件唯一的自有計時器(擴充函數生效)提供 `opt.onTrace`,測試以事件而非等待毫秒同步;效能時限類以 CPU 時間斷言

- 狀態: 已套(2026-10-29 tm-servorm,未提交、未發布).來源: 主控 timer-inv01 盤點(`C:\opensrcOper\dnow\20261029050859\agent-out\timer-inv01-盤點報告.md` §5 之 w-serv-orm 列:C 類 13 案皆為 `src/getProc.mjs` `addFun` 之 1ms 生效計時器,B 類 5 案皆為效能時限).
- 單一擁有者: 事件由 wsemi `src/getTrace.mjs`(`import getTrace from 'wsemi/src/getTrace.mjs'`)產生,本套件不自寫等價實作.
- 規則:
  1. **站點全集**: `src/` 內計時器僅 `src/getProc.mjs` `addFun` 之 `setTimeout(..., 1)`(擴充函數註冊後延後 1ms 生效,沿用既有時序,見該函數註解).盤點指令(Grep): `setTimeout|setInterval|setImmediate|debounce|throttle|AbortSignal\.timeout|Date\.now|performance\.now|delay\(|sleep\(` 於 `src/`,結果須恰為 `getProc.mjs` 一處;新增任一計時器須先歸類並依本規則提供 `opt.onTrace`.
  2. **事件格式**: `addFunCheck(f, opt)`、`addFunPreProcessing(f, opt)`、`addFunPostProcessing(f, opt)` 之選用第 2 參數 `opt.onTrace`,於該擴充函數**實際生效(已推入該實例陣列)**之當下同步通知一次,事件為凍結物件 `{ type: 'active', hook: 'check'|'preProcessing'|'postProcessing', n }`(`n` 為該實例該類擴充函數生效後之總數,含 `addFunCheck` 註冊非函數時留下之恆 reject 守門函數).註冊非函數(同步拋錯)者不通知;`getTrace` 於函數檢查之後取得,故無效函數之拋錯與守門行為不受 `opt` 影響.JSDoc:`src/WServOrm.mjs` 擴充函數段;README〈Extension functions and `opt.onTrace`〉.
  3. **P3(預設不變)**: 未給 `opt`、`opt` 為 `null`/`{}`、`onTrace` 為非函數、被 `Array.prototype.forEach` 等多帶參數(索引、陣列)呼叫者,行為與舊版相同(`unit-hookTrace` HT04);改造前測試原樣對新 src 全數通過(見 tm-servorm 報告).
  4. **P4(回調不得影響被測函數)**: 回調同步呼叫、不帶接收者;拋錯(含試圖改寫凍結事件之 `TypeError`)與回傳之 rejection 一律忽略,不影響註冊與 `procOrm`(`unit-hookTrace` HT05-HT08).
  5. **測試以事件同步**: 註冊擴充函數後須等其生效者一律經 `test/tools/hookKit.mjs` 之 `addHook(so, name, f)`(回傳 Promise,於 `active` 事件 resolve);註冊失敗(非函數)之否定觀察以 `settle(so)`(註冊無作用 check 並等其生效,同為 1ms 計時器依註冊先後生效)為屏障;防懸置上限(10 秒)用模組載入時保存之真實計時器,只防永不生效,不是同步點.**不得以 `wait(N)` 等固定毫秒等待擴充函數生效**.盤點指令(Grep): `await wait\(` 於 `test/*.test.mjs`,剩餘者須皆為 A 類(見下).
  6. **效能時限類(P6)**: 「處理量有界(不展開指數個物件、不依 `length` 迭代、原型鏈成本有界)」之斷言一律以**本行程 CPU 時間**(`process.cpuUsage`,user+system)而非牆鐘時間(`Date.now()` 差),經 `test/tools/cpuBound.mjs` 之 `cpuMs`/`cpuMsSync` 集中量測;裕度(CPU 毫秒)與各案見下表.理由: 牆鐘含行程被排程器擱置(CPU 壓力、他套件測試)之時間,與工作量無關;CPU 時間不含擱置而工作量失控時仍成比例增長.量測區間須只含微任務(不讓出給他人回呼之巨任務),否則同行程他人之 CPU 耗用亦計入.不得以重試掩蓋.環境變數 `SERVORM_CPUBOUND_LOG`(檔案路徑)給予時每次量測追加一行 JSON(`label`、`cpu`、`wall`),供訂定裕度.

## 本套件之處理清單(tm-servorm 實施時讀碼確認;與 timer-inv01 明細表之差異見報告)

| 類 | 案(檔) | 處理 |
|---|---|---|
| C(擴充函數生效) | `unit-WServOrm`: I05、I06、I08、I09、H01、K01-K07;`unit-guard`: M12b、M14、M14b;`unit-keepuser`: K12、K13;`unit-objcopy`: L05、D03;`unit-pkcast`: N09(共 20 案;明細表原列 13 案) | 改等 `addHook` 之 `active` 事件;I09、K05 之「呼叫進行中」步間改等擴充函數自身進入之 Promise;K06、K07 之否定觀察改 `settle` 屏障 |
| (d) 效能時限 | `api-objcopy`: A28;`unit-diaglog`: O14f;`unit-objcopy`: L02、S04、S06、S13(共 6 案;明細表原列 5 案,S04 為讀碼新增) | 改 CPU 時間斷言,裕度見下 |
| A(不改) | `unit-guard`/`api-guard` 之 fixture 延遲(`wait(30/40/60/80/150/250)`)與步間 `wait(10/15/20)`(鎖之取得由 Promise 微任務序保證,不受計時器延遲影響);`api-guard` R03/R04/R09/R10 之 `wait(5)`(令 `timeUpdate` 時間戳相異,時間是資料);`unit-diaglog` O03/O09 之 `wait(20/30)`(`unhandledRejection` 否定觀察窗) | 不改 |

## 效能時限類之裕度(CPU 毫秒;依負載試驗實測最大值訂定)

實測: 無負載 1 次 + CPU 壓力 8 行程 6 次 + 事件迴圈阻塞 400:1000 6 次 + 重度阻塞 1500:3000 5 次(2026-10-29 tm-servorm,`SERVORM_CPUBOUND_LOG` 紀錄,共 4,158 次量測),各斷言之最大值與裕度(裕度＝限值÷最大值):

| 斷言(案) | 限值 | CPU 最大 | 牆鐘最大 | 裕度 |
|---|---|---|---|---|
| A28 稀疏巨陣列/共用子結構(`api-objcopy`) | 1000 | 32 | 7 | 31 倍 |
| L02 `length`=2^53-1(`unit-objcopy`) | 1000 | 16 | 6 | 62 倍 |
| S04 稀疏巨陣列(`unit-objcopy`) | 1000 | 16 | 22 | 62 倍 |
| S06 指數型 DAG(`unit-objcopy`) | 1000 | 16 | 9 | 62 倍 |
| S13 20 萬層原型鏈(`unit-objcopy`) | 1000 | 376 | 303 | 2.7 倍(最小,建構 20 萬層鏈本身耗時;若日後轉紅先查機器狀態再議) |
| S13 共用長鏈 2 萬次(`unit-objcopy`) | 3000 | 188 | 209 | 16 倍 |
| O14f `cpDetail` 寬/稀疏/大物件(`unit-diaglog`) | 5000 | 281 | 271 | 18 倍 |

(`process.cpuUsage` 於 Windows 之粒度約 15.6 ms,故小值呈 0 或 16;CPU 時間含 GC 等其他執行緒,可略大於牆鐘.)

偵測力: 以變異驗證(`tmp/tm-servorm/mutate.mjs perf`):於被測路徑加入燒 CPU 迴圈(工作量失控,結果仍正確)新舊測試皆轉紅;加入不耗 CPU 之阻塞(`Atomics.wait`,模擬行程被排程器擱置)則舊測試(牆鐘)轉紅、新測試(CPU 時間)維持綠——即改版之目的.
