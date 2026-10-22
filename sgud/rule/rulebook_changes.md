# 規則帳本(破壞性變更紀錄、其他已知限制與 delAll 使用須知)

本檔為 `rulebook.md` 之分檔(2026-10-22 依全域 §14 整理: 各節原文逐字搬移,節號與標題不變,未刪改)。索引與共通事項(系列規格、測試與 lint 指令、行號基準)見 `rulebook.md`。

## 破壞性變更紀錄

- 1.1.7(`2f90d77`,2026-10-11): save、del、mix 之逐筆失敗(ok 為 0)由靜默 resolve 改為 reject;genTestData 遇逐筆失敗即拋錯.
- 1.1.8(`f42cf8e`,2026-10-12):
  - 訊息改為英文;使用端之 spec、測試若引用中文字串須同步.
  - 字串主鍵會被 clearXSS 改寫者整批拒絕.
  - 依賴 wsemi ^1.9.13: clearXSS 不再轉義數學式之 `<`、`>`,已存資料不還原.
  - 未帶主鍵者於 resolve 時回傳補出之主鍵.
  - 前處理回傳須為含 input 之物件;擴充函數註冊須為函數.
  - getDb 之 backup、recover 失敗改為 reject;backup、recover 驗證輸入與內容.
  - w-data-collector 移至 dependencies(^1.0.46).
- 1.1.9(`9b3417d`,2026-10-13):
  - 移除 useCheckUser、getUserById、useExcludeWhenNotAdmin,給予非預設值即建構拋錯.
  - procOrm 不再檢查使用者,select 不再依使用者過濾.
  - 擴充函數之參數不含 isAdmin.
  - `getProc(mapOrm)` 不再收 opt(其後恢復收 opt 以檢查已移除之設定,見下).
- 1.1.9 之後(未發布,2026-10-13):
  - 刪除 `src/getItemsFail.mjs`.深層引用者改引 w-data-collector 之 `src/getItemsFail.mjs`.
  - `getProc(mapOrm, opt)`: opt 含已移除之設定且值非未給、null、false 者拋 Error,訊息同 WServOrm(1.1.9 為靜默忽略).
  - getProc 收到非函數之 mapOrm 改為拋 Error(原回字串之 rejected Promise).
  - 新增 `src/checkOptRemoved.mjs`,可由使用端直接引用.
- 1.1.10 之後(未發布,2026-10-14;審計 run01、主控裁示 D1-D6):
  - 字串型主鍵欄(或型別未知)之有限數字主鍵改以其字串形式處置(R-ID-02): 寫入與刪除轉為字串,回報之 id 由數字變為字串(如 `123` → `'123'`);lmdb、lowdb、level、mongodb 上以數字寫入者改存為 `'123'`(原被換成 genIDSeq);select、delAll 之條件中 id 之比較運算子一併轉型(範圍比較改依字典序).
  - mix 之 add 與 del、del 與 diff 同鍵者改為整批 reject(R-MIX-01),原 resolve 而遺失資料.
  - insert、save、mix.add、mix.diff 之元素非一般物件者改為整批 reject;mix 之 add、del、diff 非陣列者 reject;delAll 之 find 非物件(且非 undefined)者 reject(R-INPUT-01).原分別寫入垃圾紀錄、回報錯亂、刪除全表.
  - 多筆批次中之空物件列改為由本套件補值並回報(R-ID-01 規則 3).
  - isPkIdString 之型別字串去參數後比對(`STRING(36)` 視為字串型).
  - 後處理之 input 之描述更正為「前處理後之 input」(行為不變).
- 1.1.11 之後(未發布,2026-10-17;審計 run01、主控裁示 D1-D4,另依外審 opus、sol 之核對結果收緊):
  - **select 之 find 若給予(非 undefined)而非純物件者改為 reject `invalid find of select, need an object`**(R-INPUT-01 規則 3).原行為: 原樣交後端,多數後端視為無條件而回全表(`null`、陣列、字串、數字、布林皆然).新行為: `null`、陣列、字串、數字、布林、函數、Date、RegExp、Map、Set、包裝物件、類別實例、`Object.create(proto)` 等 reject; `undefined`(含未給)與 `{}` 照舊為無條件.影響: 庫內盤點(w-web-api、w-web-perm、w-web-sso、w-web-task 非 dist 程式與測試,並含 w-serv-webdata、w-serv-hapi、w-runqws)0 處以非物件 find 呼叫真實 procOrm 之 select(w-web-api `server/procApis.mjs:23` 傳 `{}`;w-web-perm `test/unit-dataChannel.test.mjs:42` 傳 `'x'` 者為替身 procOrm);須留意者為經 JSON 傳輸之資料通道: 前端明示傳 `undefined` 者因陣列內之 `undefined` 成為 `null` 而被 reject(不帶參數或僅帶回調函數者不受影響).
  - **delAll 之 find 同改為純物件**(原為 isobj;R-INPUT-01 規則 3): 類別實例、`Object.create(proto)`、偽造 `Symbol.toStringTag` 之物件原通過而在字串型主鍵表被複製成 `{}` 刪全表,現 reject `invalid find of delAll, need an object`.
  - **find 或寫入列(insert、save、mix 之 add 與 diff)任何深度含自有 `__proto__` 鍵、存取器屬性(getter、setter)或不可讀者改為整批 reject**(R-OBJ-01 規則 3).原行為: find 之頂層 `__proto__` 鍵被靜默丟棄(經 castIdFind 複製時改設複本之原型),寫入列頂層之 `__proto__` 鍵被靜默丟棄,**巢狀之 `__proto__` 鍵則原樣存入**(wsemi 之 cloneDeep 以 defineProperty 保留);存取器屬性被呼叫 getter 讀取(讀兩次令檢查與使用之值可不同,getter 拋錯時以原例外 reject 並回顯其值).影響: 正常呼叫端(JSON 資料)0 影響;已存入含巢狀 `__proto__` 之資料者,select 後修改再 save 會整批 reject;行程內以 getter/setter 定義欄位之物件改為 reject.
  - 具非負整數 `length` 鍵之 find 與寫入列改為依其自有鍵處置(R-OBJ-01 規則 1、2): 修正缺陷,非破壞性變更; 原行為見該規則.曾依賴「`length` 欄之列被改寫、find 之條件被丟棄」者(不應存在)行為改變.
  - **woName 非 woItems 之自有字串屬性者改為以固定字串 reject `can not find table[<woName>] in ORM`**(R-INPUT-01 規則 5,run02).原行為: `__proto__`、`constructor`、`toString`、含 `.` 之路徑(如 `tests.select`)取到非 ORM 之值,以 TypeError 物件 reject;非字串之 woName(數字、陣列等)依 lodash get 之強制轉換可能命中同名資料表(如數字 1 命中表 `'1'`),現一律 reject(`can not find table[] in ORM`).影響: 資料表名恆為 ds 之字串鍵,正常呼叫端 0 影響;ds 之鍵含 `.` 者照常.
  - **mapOrm 之非字串例外一律轉為固定字串 `failed to process input`**(R-ERR-01 規則 5,run02 外審後).原行為: 使用端物件之 Proxy 陷阱拋錯、已撤銷之 Proxy、`mode` 為物件(`invalid mode: ${mode}` 之字串轉換拋 TypeError)、`util.inspect.custom` 拋錯、循環或共用子結構使遞迴爆堆疊、woItems 之非 ORM 值等,以 Error 物件(或被拋出之字串等原值)reject.影響: 僅行程內非常規輸入,正常呼叫端 0 影響.
  - **isPlainObj 改為 lodash isPlainObject 式判準**(R-INPUT-01 規則 3): `Object.create(Object.create(null))` 等原型為 null 原型之一般物件原通過而在字串型主鍵表被複製成 `{}`(delAll 刪全表,外審 opus 二輪 F2 以真 lowdb 實測),現 reject.insert、save 之輸入陣列與 mix 之 add/del/diff 屬性為存取器者 reject(R-OBJ-01 規則 3).recover 以自有屬性驗證 name(R-DB-01).getWoItems 以 defineProperty 建表.
  - **find 之巢狀深度超過 64 個容器層者改為以固定字串 reject `invalid find of <mode>, too deep`**(R-OBJ-01 規則 5,run02).原行為: 字串型主鍵表約 1173 層 `$and`(約 2346 個容器)起以 RangeError 物件 reject,其餘表型態原樣交後端.影響: 合理查詢最深約 7 個容器,0 影響.

- 1.1.13 之後(未發布,2026-10-19;第 33 項批 3,w-orm 系列條件白名單):
  - **select、delAll 之條件中 `$not`、`$all`、`$nor` 內之數字主鍵不再轉為字串**(R-WL-01 規則 3,R-ID-02 規則 2).此三者在系列白名單外,w-orm-lmdb、level、lowdb、mongodb、postgresql、reladb(及 mdb 發布後)皆整批 reject,經本套件則以固定字串 `failed to select data`、`failed to delete data` 回傳,原轉型分支不可達而移除.影響: 使用端若仍以這些運算子查詢,於各後端收緊後本來就被 reject;尚未收緊之後端(舊版)上,字串型主鍵表以數字查詢 `$not` 內之 id 將對不上.庫內呼叫端 0 處使用(dspec〈一之二〉).
  - 其餘行為不變: 錯誤型別、訊息、轉型範圍(白名單內 `$eq $ne $gt $gte $lt $lte $in $nin` 與 `$and`、`$or` 巢狀)、find 之純物件、`__proto__`、存取器、深度檢查皆同.
  - 文件: `WServOrm.mjs` 類別 JSDoc 與 README 增「條件(find)」與 delAll 使用須知(使用者 2026-10-17 裁示).
  - **select、delAll 之 find 內有下列者,改為以固定字串整批 reject**(R-OBJ-01 規則 6,2026-10-19 第 2 次執行,主控裁示修 F1;經 sol 與 Argon 三輪外審修正): Symbol 鍵、不可列舉鍵(`invalid find of <mode>, unsupported symbol key or non-enumerable property`);Proxy(含已撤銷者、原型為 Proxy 者)、帶 `Symbol.toStringTag` 者(自有或繼承,含 Map、Set 等內建品牌物件)、內建品牌物件(含原型被改為 null 者)、巢狀之非純物件(類別實例、偽原型)、有空洞/額外屬性/不可列舉元素之陣列、帶自有屬性之 Date、函數值、Symbol 值(`invalid find of <mode>, unsupported irregular object or array`).原行為: 字串型主鍵表之複本洗掉這些結構,令白名單版後端本會 reject 之條件變成較寬或無條件(頂層既有鍵全為不可列舉者 delAll 刪全表;原型改為 null 之 Map 作 find delAll 刪全表;空洞陣列之繼承索引、帶標籤之函數、繼承之標籤 getter 使查詢與刪除對象改變;檢查途中之 Proxy 陷阱或 constructor getter 可清空已檢查之條件);其餘表型態原樣交後端,由後端 reject.影響: 僅行程內非常規輸入,JSON 資料通道無法產生,正常呼叫端 0 影響.**注意行為變更**: ①Proxy(陷阱不拋錯者)原通過(後端亦接受),現一律 reject(無法保證檢查之值即使用之值)——以 Proxy 包裝之條件(如 Vue 響應式物件)與 Mongoose/Sequelize 文件等類別實例須先轉為純物件(如展開運算子或 `JSON.parse(JSON.stringify(…))`); ②稀疏陣列、函數值、Symbol 值、帶自有屬性之 Date 原由後端 `failed to select data` 拒收或通過,現以上述固定字串; ③`Array.isArray` 為真但原型帶標籤或原型為 Proxy 之陣列、標籤為 getter 之陣列,後端本接受,現 reject(fail-closed 超集).跨 realm 之純物件照常(字串型主鍵表之複製位置被複製為本 realm 物件,其餘位置由後端決定).寫入列不變.
- 1.1.15 之後(未發布,2026-10-20;第 82 項,Argon 外審第三輪 A-07、B-02 與核實時另發現之 F5、F6;主控裁示 Q1(a)、Q2(a)、Q3(a)、Q5 100,000、Q6 修、Q7 獨立發布): **全部僅行程內(直呼)呼叫端可達,JSON 資料通道不可達; JSON 來源之一般輸入零差異**(以 HEAD 與修正後對 180,000 組隨機 JSON 輸入逐組比對 reject/resolve 值與 ORM 實收實參,0 diffs).
  - **寫入列(insert、save、mix.add、mix.diff)與 del、mix.del 列之 `id` 只認自有可列舉之資料屬性**(R-OBJ-01 規則 7 ①、R-ID-02 規則 4 續): 不可列舉/繼承/經存取器之有限數字 id 原被轉為自有字串 id 寫入(字串型/未知型主鍵表),getter 於檢查後被執行(可寫入含巢狀自有 `__proto__` 之欄位); 現視為未提供 → 寫入列補主鍵(同直呼後端),getter 不被執行; del 與 mix.del 列之此類 id 不再被本層轉字串,原樣交後端.mix 同鍵比對不再誤拒不可列舉/繼承之 id.
  - **寫入列頂層為 Proxy、原型鏈有 `Symbol.toStringTag`、內建品牌物件者,改為整批 reject `failed to <insert|save|update> data, unsupported irregular object or array: data[k]`**(R-OBJ-01 規則 7 ②; 取代: Proxy 列通過〔陷阱被執行 14~17 次〕或陷阱拋錯時 `unreadable value`/`failed to process input`; 帶標籤之列 `not an object`; 原型為 null 之 Map 等通過並寫入垃圾列).類別實例含自有欄位之 DTO、`Object.create(proto)`、跨 realm 之列照收(主控裁示 Q1(a)).測試 P04、C02 預期隨之更新.
  - **批次容器(insert、save、del 之輸入陣列,mix 之 add、del、diff)為 Proxy、原型鏈有標籤、或有空洞者,改為整批 reject**(`unsupported irregular object or array` / `unsupported sparse array: data[k]`,R-INPUT-01 規則 1、2): 原空洞容器於 insert、save 為 `not an object: data[k…]`〔並為每個空洞配置物件,稀疏巨陣列 OOM〕、於 del 原樣交後端; 偽造標籤之類陣列容器與空洞索引在原型上帶資料之陣列原可繞過 R-OBJ-01 規則 3(含巢狀自有 `__proto__` 之列被寫入).偽造標籤之類陣列物件改視為單一列(insert、save、del)或回 `need the result object of ltdtDiffByKey`(mix).
  - **列內巢狀陣列有空洞者,改為整批 reject `unsupported sparse array: data[k]`**(R-OBJ-01 規則 7 ⑤): 原通過(並於 clearXSS 被展成密陣列),稀疏巨陣列使逐索引迴圈近乎不終止.
  - **mix.del 列之 id 為存取器、繼承、或列為 Proxy/帶標籤者,改為整批 reject `failed to delete data, unsupported irregular object or array: data[k]`**(R-MIX-01 規則 6).
  - **find: 最長路徑超過 64 個容器(共用子結構)、有循環、展開後容器數超過 100,000 者,改為固定字串 reject `too deep` / `too large`**(R-OBJ-01 規則 5 續,所有表型態): 原共用子結構通過(指數型 DAG 於字串型主鍵表展開 2^k 個物件,`--max-old-space-size=256` 下 k=22 即 exit 134); 原循環於字串型主鍵表為 `failed to process input`、其餘表型態原樣交後端.合理之重用同一子條件於多處不受影響.
  - **(外審 sol 與 minimax 第一輪後追加)**批次容器之索引為存取器者、函數型列(自有標籤之函數、callable Proxy)、mix 之 input 為 Proxy 或帶標籤者、mix.del 列之 id 為不可列舉者,皆改為整批 reject(固定字串); 已撤銷之 Proxy 作批次容器改為容器層固定訊息(原 `failed to process input` 或放行至 ORM); mix 之 add、del、diff 只取 input 之自有資料屬性(繼承者不取); 原型鏈長度逾 65 個物件之物件或陣列於 find 與寫入列視為不乾淨; 稽核欄位改以 defineProperty 寫入(類別 DTO 原型上之 setter 不再被執行); mix 之 diff 先於 del 步驟 adjustData(整批性之 `failed to adjust data` 改為發生於任何寫入之前); find 之展開上限改計物件數(不含陣列). 皆為病態/非 JSON 輸入,JSON 來源之一般輸入零差異(S08、以 HEAD 與最終程式對 180,000 組隨機 JSON 輸入逐組比對 0 diffs).
  - 影響與盤點: 以上皆為病態/非 JSON 輸入,庫內無此用法; 下游 w-web-sso、w-web-perm、w-web-api、w-web-task 之直呼輸入盤點(2026-10-20 子代理 Explore 對各 repo 之 `server/`、`src/`、g_ 腳本、`test/`、`spec/` 取證腳本 Grep 與追溯輸入來源): Proxy、`Object.create(` 作列、Array 子類別、稀疏陣列、getter/Symbol.toStringTag 之列或容器、共用/循環結構作 find,於會進入 ORM 之輸入皆 **0 筆**(輸入來源為字面量、`funNew`/ltdtmapping/`pick` 重鑄之純物件、DB select 讀出之列、前端 JSON; perm `test/unit-validateRows.test.mjs:204,211` 之偽陣列只餵檢查函數、不入 ORM); 由 select 讀出之列原樣回灌 procOrm(perm `procCore.mjs:198`、sso `procCore.mjs:1650`)以 w-orm-lowdb 實測為純物件且 save/del 回灌通過(其餘後端之反序列化未實測).
  - 文件: README 與 `WServOrm.mjs` 類別 JSDoc 增 `too large`、`unsupported sparse array` 與寫入列的乾淨判準; 列內共用子結構之展開依賴 wsemi 第 62 項(R-OBJ-01 規則 7).

## 其他已知限制

- insert(含 mix 之 add 與 recover)為主鍵已存在即略過之冪等新增,回傳之 id 含被略過者.
- mix 非交易: 逐筆失敗或後段步驟整批失敗而 reject 時,前段步驟已寫入.
- 訊息會回顯呼叫端提供之 woName 與 mode(如 `can not find table[x] in ORM`、`invalid mode: x`),前端須以文字呈現.
- 回報之 id 為本套件依輸入(含補值與 R-ID-02 之轉型)所得之預測,非後端之寫入結果(規格 T2 之回傳不含主鍵);後端比對規則較寬者(w-orm-mdb 之 Jet 不分大小寫、忽略尾端空白),insert 略過或 save 命中之對象可能與回報不同.
- 本套件以 id 為主鍵: getWoItems 只傳 url、db、cl,無從指定 `opt.pk`;主鍵欄非 id 之後端(w-orm-postgresql 預設 time)之回報 id 不具主鍵意義.
- schema 須與後端一致: lmdb、lowdb、level、mongodb 之資料表 id 須為字串型 pk 或不標型別;標為整數型或非 pk 者本套件不補值、不轉型,由後端自行產生主鍵,回報與實際不同.整數主鍵欄(reladb、mdb)須於 schema 標型別,否則數字會被轉為字串.
- mix 之回報為各步驟所處理之列之 id(add、del、diff 依序串接),不分是否命中.

## 〔delAll 使用須知(使用者裁示)〕

- 使用者 2026-10-17:delAll 須審慎使用、非必要不用;`procOrm`/`mapOrm` 之 delAll 相關 JSDoc 須載明:不給條件(未給、`undefined`、`{}`)即刪除全部;傳非條件物件會 reject(R-INPUT-01);各 ORM 之白名單外運算子會 reject(系列白名單,`C:\opensrcOper\dspec\w-orm系列條件語法支援盤點.md`〈一之三〉).狀態: 已套(2026-10-19,第 33 項批 3): `src/WServOrm.mjs` 類別 JSDoc 之「條件(find)」與「delAll(破壞性操作…)」兩段(`:24`、`:25`),及 README「Conditions (find) and delAll」節;規則見 R-WL-01 規則 5.經資料通道(w-serv-webdata)呼叫之 delAll 與此一致,不另加通道專屬限制.盤點指令: Grep `src/WServOrm.mjs`、`README.md` 搜 `delAll\(破壞性|審慎使用`.
