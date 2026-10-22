# 累積經驗(舊,2026-10-11～17)

本檔為 `experience.md` 於 2026-10-22 依全域 §14 抽出之舊經驗(各節原文逐字搬移,節號與標題不變);需要久遠經驗時再調閱。

## 審外部建議檔(建議*.md): 先驗每條主張,再分類,最後才評方案(2026-10-11～13)

- 流程:
  1. 逐條核對建議檔引用之 `file:line`,範圍含使用端與相依套件之原始碼.
  2. 依全域規範 §8 分為必修、功能疏失、設計限制、假痛,先交業主確認.
  3. 方案另評,指出結構性問題,並附替代做法.
- 案例:
  - `建議w-serv-orm修正.md`(procOrm 忽略逐筆 ok:0)屬實,修為 reject(1.1.7).
  - w-web-sso 之 `建議w-serv-orm調整.md`(procOrm 加必填之 authorize)診斷正確,但把關點錯,改放資料通道(1.1.9 只做移除).
- 業主之設計原則: opt 為選填之擴充設定,不給 opt 不得出錯;必填者須列為參數;「開啟某功能才連帶必填」者可放 opt.

## 寫給他套件之建議檔(2026-10-11～13)

- 一套件一檔 `./建議<套件>調整.md`,對象為該套件之主責 agent.
- 寫完以腳本逐一核對文件內之「檔案:行號」與引用原文;曾 46、66、84 項全數相符.2026-10-13 四檔 204 條.
- 核對腳本另做覆蓋檢查: 文件內每個 `檔案:行號`,以及其後只寫 `:行號` 之相對引用,都要有對應之核對條目,且不超出檔案行數.2026-10-13 據此發現,相對行號之前若夾了引文中之其他檔名,解析會指到那個檔,人讀也會誤會;改為寫完整路徑.
- 建議使用端刪除已移除參數之讀取時,同時處理「部署設定改為被靜默忽略」: 提供本套件之單一定義(如 `src/checkOptRemoved.mjs`)供其呼叫,不讓各使用端各寫一份規則與訊息.
- 業主轉交後會要求刪除.漏複製而要求重產時,先查被引用之 repo 自驗證後有無變動(git log、git status),無變動才逐字重產.
- 他套件與本套件互不依賴時(如 w-serv-webdata、w-serv-hapi),本套件之文件不寫死他套件之選項名;他套件之主責 agent 可能採別的做法.

## 使用端與相容驗證(2026-10-13)

- 使用端: w-web-sso、w-web-perm、w-web-api、w-web-task,位於 `C:\opensrc\開源-JS-411-8-w-web-<名稱>\w-web-<名稱>`.2026-10-12 之依賴範圍: sso 為 `^1.1.8`,其餘為 `^1.1.6`.
- 盤點使用端要搜全部 `w-serv-orm/src/` 之引用,含根目錄之 g_ 腳本、`test/tools/`、`spec/evidence/` 之取證腳本(清單見規則帳本 R-COMPAT-01).
  - 1.1.9 移除 opt 時只搜了 WServOrm,漏掉 w-web-sso 之測試直接呼叫 `getProc(mapOrm, opt)`.
  - 其後補查時,原盤點 glob(`{server,src,test}/*.mjs`)又漏了 `test/tools/unitProc.mjs` 與 `spec/evidence/*.mjs`.改為對各 repo 根目錄 Grep,只排除 node_modules、dist、docs.
  - 在 `C:\opensrc` 根目錄 Grep 或 Glob 會逾時(約 120 個 repo).先以腳本讀各 repo 兩層內之 package.json,找出依賴本套件者,再逐一 Grep.
- 被直接 import 之內部模組也是進入點.1.1.9 只在 WServOrm 檢查已移除之設定,直接呼叫 getProc 者被靜默忽略;w-web-sso 之取證腳本因此在 1.1.9 下,四組設定(含 `useCheckUser:true`)之五個寫入點皆印 ok,與其記載之 1.1.8 結果不符而不自知(2026-10-13 以導向 hook 指向 HEAD 之 src 實測).移除參數時,要列出收該參數之所有進入點,逐一套用.
- 移除介面時連本套件之測試一併清: 1.1.9 移除設定後,測試仍有 38 處傳 `useCheckUser:false`,等於示範已移除之用法.
- 刪除或改名已發布之 src 檔之前,先掃使用端之深層引用.1.1.8 開發時曾刪 `src/getItemsFail.mjs`,經複審發現 w-web-sso 引用,而改為轉出之相容檔.業主 2026-10-13 指示: 使用端皆為自有套件,不留相容檔,一律改到好.確認無引用後即刪除(該檔已刪);仍有引用者寫建議檔.
- 寫新建議檔前,先查同一使用端之舊建議檔是否已套用(看該 repo 之 HEAD 日期與被引用之行).2026-10-13 發現 10-12 之三份建議檔放在 w-web-sso 根目錄而未套用,perm、api、task 之 HEAD 仍為 10-11;其中 getUserById 訊息之條目已被 1.1.9 作廢.新檔整併仍成立之舊條目並註明取代舊檔,避免使用端收到互相矛盾之兩份.
- 不改使用端,而以本 repo 之原始碼跑使用端之真實測試:
  - 以 `module.register` 註冊解析 hook,把 `w-serv-orm/src/*` 導向本 repo,並把每次導向寫入標記檔,以證明實際載入者.hook 之 resolve 如下(REPO 為本 repo 路徑,MARK 為標記檔路徑):
    ```js
    export async function resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('w-serv-orm/')) {
            let fp = path.join(REPO, specifier.slice('w-serv-orm/'.length))
            fs.appendFileSync(MARK, `${specifier} -> ${fp}\n`)
            return { url: pathToFileURL(fp).href, shortCircuit: true }
        }
        return nextResolve(specifier, context)
    }
    ```
  - 執行端先 `register('./redirect-hook.mjs', import.meta.url)`,再動態 import 使用端之模組,或以 Mocha API 載入其測試檔.曾用於 w-web-perm 之 `test/unit-procCore-updateTabItems.test.mjs`、w-web-sso 之 `server/ormWrite.mjs`、`test/unit-optWServOrm.test.mjs`、`test/unit-ormWriteFail.test.mjs` 與 `spec/evidence/` 之取證腳本.
  - 同一腳本先以 own 模式(使用端自身安裝之版本)跑一次作基準,再以 repo 模式跑,兩者之差即本次修改之影響.
- 使用端前端皆把拒絕值當語系鍵翻譯(w-web-api 之 `$transErr`、w-web-perm 與 w-web-task 之 `tErr`、w-web-sso 之 `$tErr`).查無鍵者顯示通用訊息(`anUnexpectedErrorOccurred` 或 `cannotConnectServer`),procOrm 之原文不會出現在畫面.改訊息時要查的是使用端之 spec 與測試是否引用原字串.

## 自有套件更新(wsemi、w-data-collector)之流程(2026-10-11～12)

- 業主發布後,npm 常延遲數分鐘.三者皆到位才 `npm i <套件>@<版本>`;`npm view` 可能落後:
  - 版本資料: `https://registry.npmjs.org/<套件>/<版本>`.
  - tarball: `/-/<套件>-<版本>.tgz`,以 HEAD 請求.
  - install 所讀之 packument: 帶 `Accept: application/vnd.npm.install-v1+json`,看內容是否含該版本.
- 本環境為 VS Code 外掛: CronCreate、ScheduleWakeup 不會觸發.每 2 分鐘輪詢用背景 `until` 迴圈,明給 timeout 7200000,單段 ≤6900 秒.wsemi 1.9.13 約等 13 分鐘;w-data-collector 1.0.46 首查即可.
- 安裝後確認內容:
  - 以 `git show <提交>:package.json` 對應版本與提交.
  - 以 `git diff <舊提交>..<新提交>` 看全量改動,排除 docs、dist.
  - 以 `diff -rq node_modules/<套件>/src <repo>/src` 確認發布內容與 repo 相同.
  - 再重跑本套件與使用端之相關測試.
- wsemi 1.9.18(2026-10-17)修 clearXSS 巢狀 `length` 缺陷,`unit-objcopy` K01 取消 skip 後單檔 28 案全綠;`wsemi/src/clearXSS.mjs` 為 default export(`import clearXSS from 'wsemi/src/clearXSS.mjs'`,從 `'wsemi'` 具名匯入會失敗),探測腳本照此寫;`node --max-old-space-size=256` 下 `{length:1e8}` 巢狀值 1 ms、堆積 7 MB.

## 證明新測試之鑑別力: 以 HEAD 之 src 跑新測試(2026-10-13)

- 以 `git show HEAD:src/<檔>` 把 HEAD 之 src 寫到 `tmp/<資料夾>/src/`,並把新測試複製到 `tmp/<資料夾>/test/`.測試以 `../src/` 相對引用,裸模組名會向上解析至 repo 之 node_modules.
- 以 mocha 執行後,驗新行為之測試應恰好失敗.移除 useCheckUser 時,I03、I04、I08 恰紅,其餘 26 條綠.

## XSS 轉義之判準: 看 `<` 後接什麼,不看符號個數(2026-10-12)

- HTML 規格(Tag open state): `<` 後接英文字母、`/`、`!`、`?` 才進入標籤狀態;標籤外之 `>` 恆為文字.
- 「只有單個 `<` 或 `>` 就不轉義」不安全: `<svg onload=alert(1)//` 單獨看無害,組進頁面後由後文補上 `>` 而成標籤.
- 只看 `<` 後之字元亦不足: 兩欄各自清除後相鄰組進畫面時,前欄結尾之 `<` 與後欄開頭之字母拼成標籤(5 組中 4 組危險).故結尾之 `<` 也須轉義.
- 驗證法: 以 parse5(依 HTML5 規格之解析器)解析輸出.除單獨解析外,再嵌入 `<td>…</td>` 等前後標記,以及讓兩欄相鄰,檢查有無白名單外之元素、`on*` 屬性與 `javascript:` 網址.
- js-xss 之 `escapeHtml` 選項只作用於標籤外之文字與白名單外之標籤;屬性值走其內部之 `escapeAttrValue`.其 README 寫「不建議修改」,提案時須正面回應.

## 授權放在哪一層(2026-10-12)

- procOrm 同時被兩種呼叫端以相同參數呼叫,在 procOrm 分不出來源:
  - 使用端之伺服端程式,驗證後才寫入(如 w-web-api 之 saveApi).
  - w-serv-hapi 之資料通道,即前端直打之表操作.
- 放在 procOrm 之檢查會擋到伺服端以系統身分之寫入.w-web-sso 開 useCheckUser 時,自助註冊、金鑰與 IP 清單、應用系統金鑰之寫入全數失敗.
- 授權應放在開放處: w-serv-webdata 依 tableNames × methods 建出表操作函數之處,kpFunExt 不經此處.對標 Supabase、Firestore、Hasura 只對用戶端 API 把關.
- 查證時發現 w-serv-hapi 之 useDbOrm 預設為 true;w-serv-webdata 之建構錯誤在 hapi 內只以 error 事件送出,伺服器不啟動(程序存活但無服務).已寫入給該兩套件之建議檔.

## 建構期之檢查須早於建立資源(2026-10-13)

- WServOrm 依序呼叫 getWoItems(逐表 `new WOrm`)、getMapOrm、getProc.設定檢查若放在 getProc,拋錯時 ORM 已建立(lmdb 已開檔),呼叫端拿不到實例而無法 closeAll.故 checkOptRemoved 置於建構最前.

## 盤點範圍要涵蓋 schema 與範例(2026-10-12)

- 訊息改英文時只掃了 `src/`,漏掉會隨套件發布之 `schema/tables/tests.mjs` 之中文 log(其 `{keyTable}` 亦漏了 `$`).
- package.json 無 files 欄位,也無 .npmignore,除 .gitignore 所列外皆會發布.

## 數字主鍵審計(2026-10-14, run01)

- 範疇取類別: 「procOrm 各入口 × 各 w-orm 後端 × 各種主鍵輸入」.各後端之主鍵判準互異: lmdb、lowdb、level、mongodb 只認非空字串(數字被 genIDSeq 取代); reladb、mdb 認數字, 字串主鍵欄由資料庫轉型(sqlite 存 '123' 且各函數皆命中; Jet 之 INSERT 轉型而 WHERE 不轉, 其後比對失敗); postgresql 主鍵預設 time, getWoItems 只傳 url、db、cl 而無從指定 opt.pk.
- 跨後端實測法: 以本 repo 之真 getMapOrm 包各後端 repo 之 `src`(唯讀), 逐種主鍵輸入 × 寫入入口, 記錄回報、實際、重送、以回報 id 查與刪(`tmp/audit01/probe-pk-matrix.mjs`、`compare.mjs`).
  - reladb: 先把 models 複製到本 repo 之 tmp 再給 fdModels, 其 modifyModel 可能改寫 models 檔.
  - mdb: 以行程 cwd 下之 `src/connMDB.exe` 定位 exe 並在該處寫暫存檔(w-orm-mdb `src/jet.mjs:45-73`); 把 exe 複製到 tmp 下之 `src/` 並 `process.chdir`, 結束前 chdir 離開再刪資料夾.
  - 本機無 MongoDB、PostgreSQL、MSSQL 服務; 此三者以讀碼定案.
- 評估「改為 reject」類修正前, 先查下游之破壞步驟順序: perm、api 之同步為「先 delAll(或 del)再 procOrm insert」, 本套件新增之 reject 若下游驗證器未先擋, 會在破壞步驟之後才發生而清空資料.下游以 `^1.1.x` 依賴, 下一版於其下次安裝即帶入.
- 下游之假設要讀註解與規格: api `server/checkSyncRows.mjs:14-18` 與 perm `server/validateRows.mjs:54` 皆把 123 與 '123' 視為同一主鍵, 是選擇修正語義(轉字串)之關鍵證據.
- wsemi: `isnum` 對數字字串與 Infinity 皆為 true(對 NaN 為 false); `isearr([{}])` 為 false 而 `isearr([{}, {...}])` 為 true, 故後端對「單筆空物件」視為輸入無效、多筆批次中之空物件則照常補主鍵寫入.
- adjustData 之 clearXSS 以 lodash each 遍歷各元素: 字串、陣列元素被展開成 `{0:…,1:…}`; 數字、null、布林、Date 變成 `{}`.
- 文件之 file:line 核對: `tmp/audit01/verify-refs.mjs` 抽出引用並印出所指原文.已知誤判: 表格內之 `ok:0`、`{id:1}` 被當成行號; 同一行有多個檔案時, 相對行號之解析可能指錯檔(人讀亦然, 一律改寫完整路徑).
  - 下游各 repo 有同名檔(如 perm、api 皆有 `spec/設計要點與取捨.md`、`server/procCore.mjs`), 腳本依行內關鍵字猜 repo 會解析到他 repo 之同名檔; 曾因此未攔下「api 規格明文以數字為合法主鍵」之過度陳述(實為「待確認」).下游路徑一律前綴 repo 名, 核對時逐條看所指原文是否支持該句, 不只看檔案在不在.
- 獨立複審(opus 子代理)找出自審表之漏格逾 30、錯格 4 處, 含一條高嚴重度: mix 依 add、del、diff 之序執行, add 與 del 同鍵時 insert 略過、del 刪除而 resolve 遺失資料; 主鍵正規化(轉字串)會把呼叫端以嚴格比對算出之 add 123、del '123' 變成同鍵.教訓:
  - 任何「把兩個值視為同鍵」之正規化, 都要回頭查依序執行之批次操作(mix、先刪後增之下游流程)是否因此產生同鍵之互斥步驟.
  - 原型之測試草稿全過不代表安全: 替身 ORM 不會略過已存在者, 看不到 insert 略過加 del 刪除之組合; diff 類批次操作須以真後端測.
  - 前置狀態軸要含「表內已有他方寫入之同值資料」, 只測「本呼叫端重送」不夠.
- Mongoose 之 String 路徑對 `$gt`、`$gte`、`$lt`、`$lte`、`$not`、`$all` 亦經 castForQuery(`lib/schema/string.js` 之 `$conditionalHandlers`); 對標「轉型」時要含比較運算子, 只轉等值類為部分對標.
- 後端對 delAll 之無效 find(陣列、字串、null)一律刪全表(lmdb、lowdb、reladb 實測), 統一規格未定義; procOrm 原樣轉交.
- 本 session 以 `claude -p` 派工時, 結束回合即交出最終結果, 背景子代理之完成不會再叫醒; 等待子代理改用前景之條件等待(until 迴圈, 每段 ≤ 9 分鐘, 工具 timeout 600000), 完成通知會附在該次工具結果之後.

## 數字主鍵修正與下游驗收(2026-10-14, run02)

- 轉型之落點要逐一核對每個 ORM 呼叫: 以 `wo\.(select|insert|save|del|delAll)\(` 盤點 mapOrm 之全部 9 處呼叫, 每處標明經哪個轉型函數或刻意不轉; 只改寫入而漏掉查詢條件或 mix 之 del, 會造成「寫得進、查不到」之新不對稱.
- 下游繞過 procOrm 之路徑看不到本套件之轉型: api 同步之檢查以 `woItems.select({ id: { $in: ids } })` 直呼後端(w-web-api `server/WWebApi.mjs:646`), 數字 123 對 lmdb 之 `'123'` 查不到而漏判跨群組同鍵, 字串 `'123'` 則被擋(實測 reason 'group').正規化放在共用層時, 要列出下游直呼 woItems 之處並交建議書.
- 修正會讓「原本碰巧安全」之路徑變危險: 數字原被換成隨機主鍵, 不同來源用同一流水號也不會互撞; 轉字串後即互撞, 而 insert 對已存在者略過仍回 success(perm、api 外部同步實測).評估語義修正時, 要問「原行為有沒有意外提供的保護」.
- 下游驗收之兩種做法:
  - 單元測試: 以 `module.register` 之 resolve hook 把 `w-serv-orm/...` 之深層引用導向本 repo 之 src, 用 Mocha API 跑下游測試檔, hook 寫標記檔證明實際載入者(`tmp/run02/hook/run-downstream.mjs`).跑前後比對下游 `git status --porcelain` 之雜湊, 確認未留檔.
  - 真服務: 以絕對路徑 import 下游之 `server/WWeb*.mjs` 與其 node_modules 之 ORM, 自行注入 getUserByToken 等, 起在 8400-8424, 以 fetch 打端點(`tmp/run02/srv/run-sync.mjs`).import 前先 chdir 到 tmp 工作夾(下游會在 cwd 建 `uploadTemp`、`tableTags-*.json`、讀寫 `dist`).
- srLog(pino transport)於 stop() 之後才落檔, 相對路徑之 logFd 依「落檔當下」之 cwd 解析: 曾在 stop 後 chdir 回 repo 根, 結果在 repo 根多出 `logs/`.logFd 一律給絕對路徑, 且行程結束前不切回 cwd.
- LMDB 之檔案在行程結束前被鎖, 行程內 `rmSync` 失敗; 工作夾改由外層 shell 於行程結束後刪除並以 `[ -d ]` 回驗.
- w-orm 之 change 事件參數為 `(mode, data, res)`(w-orm-lmdb `src/WOrmLmdb.mjs:193`), 不是單一物件; 監聽者寫成 `(ev) => ev.data` 會一律取到 undefined 而誤判「事件不含主鍵」.
- 大段插入程式後, 帳本中其他規則引用該檔之行號全數移位: 不只回填新規則, 要重跑每條規則之盤點指令重取行號.

## lodash each 對使用端物件之陷阱與審計法(2026-10-17, run01)

- lodash `each`/`map` 等集合函數對「具非負整數 `length` 屬性」之物件(`isArrayLike`: `length` 為 `0..2^53-1` 之整數,且不是函數)採陣列樣迭代,只走索引 `0..length-1`.使用端物件(find、寫入列)含 `length:<整數>` 時真實鍵全丟,`length` 為 `2^53-1` 時近乎不終止(空 callback 2e7 次 61 ms,故可由資料通道送入而癱瘓事件迴圈).`{length:1.5}`、`{length:'3'}`、`{length:-1}`、`{length:null}` 不受影響(可作對照).
- 審計法: 先以自建夾具重現(lowdb + 對 `woItems.tabA.select/delAll` 加 spy,記 ORM 實收之實參),判定屬實;再盤點「迭代或複製使用端物件」之站點(`git grep -n "each(\|map(\|\[k\] *=\|\[kk\] *=" -- src`),逐站判準(使用端物件/陣列/內部結構);**也要查被呼叫之相依函數**(wsemi `clearXSS` 對欄位值內之巢狀物件亦用 lodash each,本套件無法於專案端修,寫 `建議wsemi修正.md`).
- 探測腳本之取值陷阱: spy 記錄與「讀回表內容」「直呼 ORM 對照」共用同一 spy 時,取 `seen[seen.length-1]` 必須在發出 procOrm 之後、其他 ORM 呼叫之前,否則取到後來的呼叫(本次初版探測因此把 delAll 顯示成 undefined,把 `__proto__` 顯示成「ORM 收到仍有該鍵」,修正後才對).
- `r[k] = v` 之 k 為 `__proto__` 時改設原型而不建立自有屬性,該鍵靜默消失; 複本用 `Object.fromEntries`(或展開 `{...v}`)才建立自有屬性.`__proto__` 自有鍵只能由 `JSON.parse`/`defineProperty` 產生,物件字面量 `{__proto__: x}` 是設原型.
- 修前紅/修後綠之證明法: 修程式之前,把 HEAD 之 `src` 複製到 `tmp/red/src`,新測試複製到 `tmp/red/test`(測試以 `../src` 相對引用),從 repo 根以 `node node_modules/mocha/bin/mocha.js --no-parallel tmp/red/test/*.test.mjs` 執行(測試之 fixture 為 cwd 相對路徑,落在 repo 根之 `test/_tmp`,由測試自刪).2 案行為鎖定者應綠,其餘紅.
- 變異測試: `tmp/mut/run.mjs` 為每個變異複製 `src`、`schema`、相關測試與 `test/tools`,對複本之 `getMapOrm.mjs` 以「恰出現一次之錨點」做字串置換(出現次數不為 1 即拋錯,防止變異未生效而誤判),再跑測試並解析失敗案號.本次 12 種變異(D1 三處、D2 五處、D3 四處)皆使至少 1 案轉紅,無變異基準全綠.測試若會對變異後的程式迴圈到近乎不終止(`length` 極大),測試須先以有限大小(2e6)先斷言,再跑極大值,避免變異後掛住.
- 大物件之比對: `assert.deepStrictEqual` 對含數百萬鍵之物件,失敗時差異輸出會癱瘓測試; 測試用 `util.isDeepStrictEqual` 加簡短訊息(`test/tools/ormStub.mjs` 之 `same`).
- 資料通道上 `select(undefined)`: 前端 `args=[...arguments]` 經 JSON 後陣列內之 `undefined` 成 `null`,故明示傳 `undefined` 到本套件為 `null`,被 select 之 find 檢查 reject; 不帶參數或僅帶回調函數者到達為 `undefined`,照常.其餘庫內呼叫端(api `procApis.mjs:23` 傳 `{}`)皆為物件.
- woName 為使用端字串(超出本次範圍,另列待裁示): `get(woItems, woName, null)` 對 `__proto__`、`constructor`、`toString`、`tabA.select` 等會取到非 ORM 之值,`wo.select is not a function` 以 TypeError(非字串)reject,違反 R-ERR-01 規則 1.
- 外審派工: 審查者之探測副本放輸出目錄 `work/`(複製 `src`、`schema`、`test`、`package.json`,`node_modules` 以 `fs.symlinkSync(…, 'junction')` 連到 repo 之 node_modules;bash 的 `cmd //c mklink` 在含中文路徑下失敗); 提示詞明寫「repo 唯讀、探測在 work/ 副本、不得以 repo 既有檔案為刪除合併搬移覆寫類函數之對象」,收回後以 `git status` 確認 repo 無非預期異動.能力探測兩家(opus、sol)各 11 秒通過(讀含中文之 repo 檔、寫輸出目錄、執行 node).

## 外審(opus5.5 xhigh、gpt-6.1-sol max)對 R-OBJ-01 初版之核對(2026-10-17, run01)

- 兩位各約 14 分鐘完成,共提 11 條(opus 6、sol 5),合併 10 列,全部屬實或部分屬實,0 誤報,其中 7 列為對方未提(獨家).詳見 `agent-out/run01-審計與修正報告.md` 〈外審評分表〉.
- 初版 D2 檢查(hasProtoKey)的缺陷,往後寫「預檢使用端物件」之函數時先自查:
  1. 預檢以 `o[k]` 讀值,會呼叫 getter: 檢查讀一次、複製再讀一次,getter 可回不同值,令「檢查之值≠使用之值」(select 改查另一筆、delAll 改刪另一筆,並可繞過 `__proto__` 檢查);getter 拋錯時,原本被 adjustData 之 try/catch 轉為固定字串者,變成在檢查處以原例外(連同其拋出之字串)reject.解法: 以 `Object.getOwnPropertyDescriptor` 讀值,遇存取器即 fail-closed reject,整段包 try/catch 轉為固定訊息.
  2. 只在 `isobj` 分支檢查自有 `__proto__` 鍵,陣列本身被略過(`defineProperty([], '__proto__', …)`).陣列以索引迭代是迭代的例外,不是檢查自有鍵的例外.
  3. 型別判準用 isobj(`Object.prototype.toString`)不夠: 類別實例、`Object.create(proto)`、偽造 `Symbol.toStringTag` 之 Map 皆通過,而其自有可列舉鍵為空,在字串型主鍵表被複製成 `{}`,select 回全表、delAll 刪全表.條件物件改用純物件判準(原型為 null 或原型之原型為 null,跨 realm 亦通過).
  4. 註解與 JSDoc 不可斷言「只有 JSON.parse 能產生自有 `__proto__`」: `Object.fromEntries`、展開、`structuredClone` 皆能.「原行為靜默丟棄」亦只對頂層成立,巢狀之 `__proto__` 在 HEAD 被 wsemi 之 cloneDeep 原樣保留(實測).
- 測試的預言機陷阱:
  1. `util.isDeepStrictEqual({__proto__:{name:'x'}, id:'a'}, {id:'a'})` 在 Node 24 為 true(不比較原型鏈內容); 而 `r['__proto__']=v` 的症狀正是原型被換掉,故 `same()` 須另補逐層原型比較(`test/tools/ormStub.mjs` 之 protoDiff).
  2. 預期值不可取自被測函式的回傳值(A15 初版以 `r[i].id` 覆寫全部列之預期主鍵,被錯改既有主鍵時回傳與讀回一致而測不出).已帶主鍵者預期取自輸入,未帶者才取自回傳並另驗補值條件.
  3. 未轉型之資料表(整數主鍵、ds 無該表)原物件交 ORM,內容斷言恆真; 要另外斷言「同一參考」,使鑑別力來源明示.
- 審查者的探測副本: 提示詞給 `work/` 副本與 diff 檔,明寫「repo 唯讀」,收回後以 `git status` 確認無異動(本次 repo 無非預期改動); 審查結束後移除副本內指向 repo node_modules 之連接點(`fs.rmdirSync(link)` 非遞迴,對連接點只移除連結; 事後確認 repo 的 `node_modules/lodash-es` 仍在),避免日後遞迴刪除 `work/` 時沿連接點刪到 repo.
- 最終統計(收外審意見後): 無變異 70 案全綠(新測試 2 檔加 unit-pkcast、api-pkcast、unit-mapOrm),17 種變異皆轉紅(D1 三處、D2 八處、D3 六處);HEAD 之 src 跑新測試(L06 加入前)17 案紅、2 案行為鎖定綠、1 案 pending(K01);全套 `npm test` 120 通過、1 pending.

## woName 查表與 find 深度上限(2026-10-17, run02)

- lodash `get(obj, key)` 對使用端字串當鍵有兩個陷阱: ①取到原型鏈上之值(`__proto__`、`constructor`、`toString`、`hasOwnProperty`…); ②解析路徑(`'tests.select'`、`'tests["select"]'`),鍵本身含 `.` 且為自有屬性時 lodash 先當直接鍵(`isKey`),所以含 `.` 之資料表名照常.改用自有屬性判斷(`typeof k === 'string'` 加 `Object.prototype.hasOwnProperty.call`)並非名稱黑名單,`constructor` 若是 ds 之鍵仍可用(測試 W02).非字串 woName 一律拒絕(原 lodash 會把數字 `1` 當成表 `'1'`),訊息不回顯非字串.
- 遞迴爆堆疊之實測閾值(Node 24.19.0,字串型主鍵表 select,替身 ORM,二分): `$and` 巢狀約 1173 層(約 2346 個容器)、`$not` 鏈約 1857 層; 閾值隨呼叫時之堆疊用量變,故上限(64 個容器層)取遠低於之值.整數型主鍵表與無該表者原物件交 ORM 而不遞迴,上限同樣適用(後端自身之遞迴亦受保護).
- 深度以「容器層數」計(一般物件與陣列各一層,根為第 1 層),`$and` 每邏輯層佔 2 層.走訪用堆疊成對存節點與層數,到第 65 層容器即返回,不走更深.`seen` 防循環與共用子結構會使:循環不被判為過深、共用子結構在較深處重複出現不重算深度(最壞約 2 倍上限),皆已記帳本.
- 寫入列深層巢狀: 本套件對列之處理非遞迴(mapOwn、castIdRows),遞迴在 wsemi clearXSS(含 lodash cloneDeep),約 1e3 層通過、1e4 層起 RangeError,被 adjustData 之 try/catch 轉為 `failed to adjust data`(實測 insert、save、mix.add、mix.diff 於 1e4、1e5 層),故不設上限; 以 T02 鎖定.
- 變異測試之 off-by-one 變異(`>` 改 `>=`、`> max+1`)是檢驗邊界測試最直接的方法,邊界測試必須同時含「恰在上限(通過)」與「恰超過 1 層(拒絕)」兩側.
- 變異工具偶發原生崩潰(exit 134、0xC0000409,出現在連續 26 次 spawn 之最後兩次,重跑 3 次皆正常): 視為環境暫時性,不是測試不穩; 為此對新測試與 `npm test` 各重跑多次(6 與 3 次)皆 exit 0.工具已加 `node tmp/mut/run.mjs <名>` 單跑並於無法解析結果時印出輸出尾端.

## run02 外審(opus 一家,sol 與 Argon 額度用盡)之教訓(2026-10-17)

- 額度用盡之判定與處置: Codex 的 `result.json` 只有 `ok:false, code:1, errorType:'exec'`,`stderr` 被截成尾端(只剩提示詞回顯),看不出原因; 要查 Codex 自己的 session 紀錄 `~/.codex/sessions/<年>/<月>/<日>/rollout-*-<session id>.jsonl` 尾端的 `task_complete.error`(本次為 `usage_limit_exceeded`,附重置時間).Argon 則直接在 stderr 出現 `RESOURCE_EXHAUSTED (code 429): Individual quota reached`.兩家用盡後依規定不再重派,只等 opus.
- 逐站確保 R-ERR-01 會漏: 外審找出 8 種「本套件檢查階段拋出非字串」之漏網(Proxy 列的 `isobj` 讀 toStringTag、`mode` 為物件之模板字串、`console.log(input)` 觸發 inspect.custom、遞迴爆堆疊、woItems 之非 ORM 值…).結構性解法是在 mapOrm 邊界以單一 try/catch 兜底(execMapOrm),字串原樣、非字串 console.log 原文後以固定字串 `failed to process input`; 先前逐站的特定訊息(`unreadable value` 等)優先.測試 C01–C05.
- 預檢與使用須讀同一份值: 容器(insert/save 的輸入陣列索引、mix 的 add/del/diff)為 getter 時,各檢查各自重讀會看到不同值; 對容器逐索引取描述子(存取器即 reject),並對 mix 輸入取快照(add/del/diff 各讀一次,其後只用快照).測試 P06.
- `isPlainObj` 的「原型之原型為 null」只是必要條件: `Object.create(Object.create(null))`(原型為 null 原型之一般物件)也滿足,而其條件繼承自原型、自有鍵為空 → 字串型主鍵表被複製成 `{}` → delAll 刪全表.改 lodash 作法: 原型為 null,或原型之原型為 null 且有 constructor 函數且其原始碼同 `Object`(跨 realm 通過).因 `p` 的原型為 null,`p.constructor` 只可能是自有屬性,故不必再 `hasOwnProperty`(該條件為多餘,變異測試 D3g 原版存活即由此發現).
- 變異測試發現的等價變異: 先寫的防禦條件若被另一條件涵蓋(`hasOwnProperty(p,'constructor')` 被 `typeof p.constructor === 'function'` 涵蓋),拿掉後測試不紅 → 不是測試漏洞而是多餘程式碼,應刪程式而非加測試.
- 以 `util.format` 取代 quiet 才測得出 `console.log` 的副作用: quiet 把 console.log 換成空函數,不會格式化引數,所以測不出 inspect.custom 拋錯.
- 深層結構測試的環境相依: wsemi clearXSS 對深層列之通過層數隨 JIT 與 `--stack-size` 浮動(冷啟動約 1000 層通過、1500 層失敗; `--stack-size=8000` 下 1e4 層亦通過),測試只斷言「不以 Error 物件 reject」,不鎖定特定訊息.
- 共用子結構(DAG): 檢查以 seen 去重、castIdFind 依路徑展開,兩者不一致; 指數 DAG(49 個容器)可令行程 OOM.JSON 只能產生樹,行程內呼叫端為受信任之程式碼,且重用同一子條件物件是合理寫法,故記為已知限制而不 fail-closed 拒絕共用.做法備案: 路徑計深度加累計路徑展開節點數上限.
- 變異工具: 錨點若同時出現在兩處(`d.get !== undefined || …`)須加上下文行; 檔案可能是 CRLF,多行錨點要依檔案實際換行符轉換; 允許對其他檔(getWoItems、getDbBackupAndRecover)套變異,並可只跑指定 `--grep` 的單案.

## 工具細節(2026-10-11～13)

- eslint 8 以目錄為參數回 No files matching,改給 `src/*.mjs test/*.mjs` 等樣式.
- Grep 工具(ripgrep)不支援反向參照.
- 在含 node_modules 之 repo 根目錄以 Glob `*.md` 搜尋,會遞迴掃進 node_modules;改用 `ls` 或指名檔名.
- getDb 之輸出目錄於模組載入時取 cwd;寫檔之測試以子程序執行,cwd 設在 `test/_tmp/<案名>/`.
