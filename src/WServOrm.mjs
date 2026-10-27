import pmSeries from 'wsemi/src/pmSeries.mjs'
import pmKeyMutex from 'wsemi/src/pmKeyMutex.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import checkOptRemoved from './checkOptRemoved.mjs'
import { checkContract, compareBaseline } from './baseline.mjs'
import getDbBackupAndRecover from './getDbBackupAndRecover.mjs'
import getWoItems from './getWoItems.mjs'
import getMapOrm from './getMapOrm.mjs'
import getProc from './getProc.mjs'


function getTabsLock(woItems, tableNames, fn) {
    //withTabLocks之輸入檢查並回傳去重且依表名碼元序排序之表名: 表名須為本實例之資料表(拼錯之表名會鎖到無人使用之鍵而靜默失去互斥), fn須為函數
    if (!Array.isArray(tableNames) || tableNames.length === 0) {
        throw new Error('invalid tableNames of withTabLocks, need a non-empty array of table names')
    }
    for (let t of tableNames) {
        if (typeof t !== 'string' || !Object.prototype.hasOwnProperty.call(woItems, t)) {
            throw new Error('invalid tableNames of withTabLocks, need own table names of this instance')
        }
    }
    if (!isfun(fn)) {
        throw new Error('invalid fn of withTabLocks, need a function')
    }
    return [...new Set(tableNames)].sort() //預設排序為UTF-16碼元序, 不用localeCompare
}


function mkErrBaseline(c) {
    //baseline不符之reject: message與key皆為固定英文拒收鍵, 另附差異供使用端診斷
    let e = new Error(c.reason)
    e.key = c.reason
    e.added = c.added
    e.removed = c.removed
    e.changed = c.changed
    e.reordered = c.reordered
    return e
}


/**
 * 產生伺服器ORM的支援物件
 *
 * 每次呼叫各自建立資料表ORM、設定與擴充函數，同一行程內之多個實例互不干擾；同一url與db之資料庫資源能否並存，依所用ORM而定。
 *
 * procOrm之save、del與mix，於ORM回傳之逐筆結果有任一筆ok為0(單筆失敗)時reject，訊息列出失敗筆之主鍵，如'failed to save data: id[b]'(超過100字元者截斷顯示；無有效主鍵者以data[k]列其於輸入內之位置，k自0起；超過10筆者只列前10筆並附總筆數)，錯誤原文另由console.log輸出。
 * 單筆失敗不中斷整批，故reject時其餘筆數已寫入。
 * 寫入類函數之回傳凡可表達失敗者一律檢查，失敗即reject或拋錯，不當成功(規則帳本R-ORM-RESULT-01)：save、del與mix之del、diff若ORM改回聚合物件而ok為0(非契約形狀，無從逐筆列出)亦視為失敗，以固定字串'failed to save data'、'failed to delete data'、'failed to update data'reject，mix之del、diff遇此視為整批性錯誤而立即reject，後續步驟不執行；delAll依契約回傳聚合物件且ok恆為1(錯誤皆整批reject)，ok為0(或回傳逐筆陣列而任一筆ok為0)以固定字串'failed to delete data'reject；讀取類select之回傳為數據列(列內欄位可能名為ok)，失敗只以reject表達，不檢查ok。
 * insert(含mix之新增)依ORM契約回傳聚合物件且ok恆為1(錯誤皆整批reject)；ORM若resolve聚合物件而ok為0，或回傳逐筆陣列(非insert契約形狀)而任一筆ok為0(違約或他種後端)，亦視為失敗，以固定字串'failed to insert data'reject(錯誤原文另由console.log輸出)，已寫入之筆無從回復；mix之新增遇此視為整批性錯誤而立即reject，後續del、diff步驟不執行。回傳undefined、null、無ok鍵之物件、空陣列或逐筆皆ok非0之陣列者不檢查，維持舊行為；略過既有主鍵(n為0、ok為1)為正常結果。備份還原(recover)之逐表insert同此判準，失敗時於該表停止並以Error reject(訊息為'failed to recover data into table[表名]: '接ORM回傳原文，逐筆陣列則列失敗筆{k,id,err}，至多前10筆並附總筆數，另列先前已寫入之表)，之後之表不寫入，先前之表與該表已被ORM寫入之筆無從回復。
 * mix之各步驟遇單筆失敗不中斷後續步驟，待全部步驟完成後一併reject；遇整批性錯誤則立即reject，後續步驟不執行。mix於resolve時回傳各步驟所處理之列之id(依add、del、diff之序串接，del之列不分是否命中)。
 *
 * insert、save與mix之新增、修改，數據未帶有效主鍵(未給、null、空字串，或非字串非數字之值，含NaN與±Infinity)者，若資料表之主鍵欄為id且為字串型(或型別未知；型別如STRING(36)者以括號前之字判定)，由本套件產生主鍵(同各ORM之genIDSeq)並於resolve時回傳；單一空物件與只含一個空物件之陣列不補(ORM視為無效輸入而不寫入)，多筆批次中之空物件列則補。
 * 主鍵欄為字串型(或型別未知)之資料表，主鍵為有限數字者一律以其字串形式處置(如123視為'123')：寫入、resolve回傳、del與mix之刪除，以及select、delAll條件中主鍵之比較($eq、$ne、$gt、$gte、$lt、$lte、$in、$nin，含$and、$or之內)皆同，故以數字或其字串形式寫入、查詢與刪除者為同一筆，範圍比較依字串之字典序；主鍵欄為整數型者不轉型。轉型只作用於procOrm，經woItems直接操作者不轉型。舊版w-orm-mongodb(2025-04-29以前)保留之數字主鍵資料，以數字查詢將查不到。
 * reject時不回傳補出之主鍵，故重送未帶主鍵之數據會再產生新主鍵而重複寫入，需冪等重送者請自帶主鍵(非空字串或有限數字)；save帶主鍵者重送以主鍵覆寫，del重送時已刪除者為主鍵未命中。
 * 回傳之id為本套件依輸入(含補值與轉型)所得之主鍵，非ORM之寫入結果；ORM之比對規則較寬者(如w-orm-mdb之Jet不分大小寫、忽略尾端空白)，insert略過或save命中之對象可能與回傳之id不同。lmdb、lowdb、level、mongodb等主鍵固定為字串id之ORM，其資料表之id須為字串型pk或不標型別；本套件以id為主鍵，主鍵欄非id之ORM(如w-orm-postgresql預設為time)之回傳id不具主鍵意義。
 * 輸入之形狀：insert與save之各筆、mix之新增與修改之各筆須為物件，mix之add、del、diff若給予須為陣列，select與delAll之條件若給予須為純物件(原型為null或Object.prototype；未給、undefined與空物件{}為無條件：select回全部、delAll刪除全部；null、陣列、字串、數字、布林、函數、Date、RegExp、Map、Set與類別實例皆reject)，否則於任何寫入或查詢之前reject，如'failed to insert data, not an object: data[0]'、'invalid find of select, need an object'、'invalid find of delAll, need an object'。
 * 條件(find)：select與delAll之條件僅支援系列白名單，由各w-orm-*依相同規則檢核(須為已實作該白名單之w-orm-*版本；舊版或尚未更新者仍可能接受白名單外之運算子，不在下述保證內)，本套件不依運算子放行或攔截(僅轉型主鍵條件，見上)：欄位等值{欄:純量}(多欄為AND)、欄位運算子$eq $ne $gt $gte $lt $lte(值為純量)與$in $nin(值為純量陣列)、文件層$and $or(值為條件物件之非空陣列)；純量為字串(不含NUL字元與孤立代理字元)、有限數字、布林、有效Date，null僅可用於欄位等值、$eq、$ne。白名單外之運算子($not $nor $regex $options $exists $all $where $expr $like $ilike等)、欄位層$and/$or、函數值、undefined值、空的$nin/$and/$or等，由ORM整批reject，procOrm以固定字串回傳(select為'failed to select data'，delAll為'failed to delete data')，ORM之錯誤原文只由console.log輸出，delAll不刪除任何數據。select未給、為undefined或{}時回傳全部數據；select(find)命中之數據即delAll(find)刪除之數據。
 * delAll(破壞性操作，須審慎使用，非必要不用；刪除單筆請用del)：不給條件(未給、undefined或{})即刪除全部數據，不另行確認，給了條件才是部分刪除；傳了值卻不是條件物件(null、陣列含[]與[{...}]、字串、數值、布林、函數、Date、RegExp、Map、Set、類別實例等)一律整批reject，不視為{}，不刪除任何數據。經資料通道(前端直接操作資料表，如w-serv-webdata)呼叫之delAll與此語意一致，不另加通道專屬限制，以免用法歧異造成誤解；通道端若另有更窄之條件限縮，未通過者由通道端拒絕，授權仍由開放處負責；通訊內容經JSON序列化時，顯式傳入之undefined會成為null而被reject，前端須省略參數或傳{}。條件值若來自可能為undefined、null或空陣列之變數，呼叫端須先自行判斷(undefined值會reject而非被忽略，空的$nin會reject，$in:[]則為恆假而刪除0筆)；建議先以select(find)確認命中範圍再刪除(ORM啟用快取而他方已寫入時，select可能回傳快取，而delAll一律直讀資料庫，預覽不保證即實際刪除之集合)。n與nDeleted皆為實際刪除筆數，條件無命中時回{n:0,nDeleted:0,ok:1}，不視為錯誤。
 * 資料表名(procOrm之woName)須為本實例資料表之自有名稱，否則reject 'can not find table[x] in ORM'(原型鏈上之名稱如constructor、toString與路徑字串如tests.select亦然)；select與delAll之條件之巢狀深度(物件與陣列各算一層，共用子結構與循環以最長路徑計)超過64層者reject 'invalid find of select, too deep'，共用子結構依出現次數展開後之物件總數(不含陣列)超過100000(與後端maxNodes同值，本層只計物件、為其子集)者reject 'invalid find of select, too large'(同一子條件被重用於多處之合理寫法不受影響)；物件或陣列之原型鏈長度超過65層者視為不乾淨而reject 'unsupported irregular object or array'。條件與寫入列(insert、save、mix之新增與修改)之任何深度(一般物件之值、陣列之元素)含自有__proto__鍵(JSON.parse、Object.fromEntries、structuredClone等可產生；物件字面量之__proto__為設原型而不算)或存取器屬性(getter、setter)者整批reject，如'invalid find of select, unsupported key[__proto__]'、'failed to insert data, unsupported accessor property: data[0]'，訊息不回顯客戶端之值。select與delAll之條件另拒絕複製時會被洗掉之結構，整批reject：Symbol鍵或不可列舉鍵('invalid find of select, unsupported symbol key or non-enumerable property')；Proxy(含已撤銷者、原型為Proxy者)、帶Symbol.toStringTag者(自有或繼承，含Map、Set等內建品牌物件)、內建品牌物件(含原型被改為null者)、非純物件(類別實例、偽原型等)、有空洞或額外屬性或不可列舉元素之陣列、帶自有屬性之Date、函數值與Symbol值('invalid find of select, unsupported irregular object or array')，使後端所見之條件同呼叫端所給者，且檢查期間與拒收後之診斷輸出皆不執行使用端程式(陷阱、getter、Symbol.toStringTag與util.inspect.custom；被拒條件以本層建立之純資料快照輸出至console.log，字串長度、層數與項數有上限)；以Proxy包裝之條件(如Vue響應式物件)與Mongoose等文件須先轉為純物件(寫入列不在此限)。跨realm之純物件照常：於字串型主鍵表之複製位置(頂層、$and/$or元素、id之運算子物件)被複製為本realm物件，其餘位置原樣交後端，現行後端白名單要求本realm物件而reject。含整數length鍵之條件與寫入列本身依其自有鍵處置，不被當成陣列樣物件；欄位值內之巢狀物件之XSS清除由wsemi之clearXSS進行，不在此限(見規則帳本R-OBJ-01之已知限制)。mix之del各筆與單獨del之各筆不做上述各項檢查(交ORM逐筆處置)，惟批次容器與mix.del列之id另受下一點限制。
 * 寫入列(insert、save、mix之新增與修改)、del與批次容器(通過檢查之後，本層不再執行使用端程式：不呼叫getter、setter與Proxy陷阱，複製只取已驗證之資料)：列之主鍵(id)只認自有、可列舉之資料屬性(以屬性描述子讀取，不執行getter)，通過鍵檢查後不可列舉、繼承或經存取器者視為未提供(寫入列由本套件補主鍵，與直接呼叫ORM寫入不可列舉之id時一致)，自有可列舉之存取器id則先整批reject('unsupported accessor property: data[0]')；列本身為Proxy(含Vue響應式物件與已撤銷者)、函數(含callable Proxy與宣稱Symbol.toStringTag之函數)、原型鏈上有Symbol.toStringTag、或util.types可辨識之內建品牌物件(如原型被改為null之Map、Set；WeakRef、FinalizationRegistry、Intl.*、KeyObject、Blob、URL等宿主物件不辨識，結果與直接呼叫ORM一致)者整批reject，如'failed to insert data, unsupported irregular object or array: data[0]'，且不觸發Proxy陷阱；以Proxy包裝之列或陣列(如Vue響應式)須先轉為純物件；類別實例含自有欄位之物件、Object.create(proto)、跨realm與null原型之列照常(僅複製自有可列舉鍵)。insert、save、del之輸入陣列與mix之add、del、diff須為乾淨之真密陣列且各索引為自有資料屬性：Proxy(含已撤銷者)、原型鏈有標籤、有空洞、索引為存取器者整批reject，如'failed to insert data, unsupported sparse array: data[1]'(稀疏巨陣列如new Array(2**32-1)於首個空洞即被拒，不逐索引迴圈)，列內巢狀陣列有空洞者亦然；偽造Symbol.toStringTag為Array之類陣列物件不視為陣列。mix之輸入物件本身須為乾淨之一般物件，add、del、diff只取其自有資料屬性；mix之del列另須其id若存在為自有、可列舉之資料屬性(不得為存取器、繼承而來、不可列舉，列不得為Proxy、函數宣稱標籤或帶標籤)，否則整批reject 'failed to delete data, unsupported irregular object or array: data[0]'，使同鍵比對所見之id即ORM刪除所用之id。單獨del之各筆不做列檢查(交ORM逐筆處置)。稽核欄位(userId、timeCreate、userIdUpdate、timeUpdate)以defineProperty寫入，類別DTO原型上之setter不被執行。列內欄位值為共用子結構(DAG)者，其展開由wsemi之clearXSS進行，本套件之走訪為線性(見規則帳本R-OBJ-01規則7)。
 * mix之add與del、del與diff含同一主鍵(依上述轉型後)者，於任何步驟之前整批reject且不寫入任何一筆，訊息列其位置而不回顯主鍵，如'invalid input of mix, same id in add and del: add[0], del[1]'；因mix依add、del、diff之序執行，同鍵將使新增因已存在而略過後即被刪除。
 * insert(含mix之新增)為主鍵已存在即略過之冪等新增，回傳之id含被略過者；recover亦以insert還原，故資料表須先清空。
 * insert、save與mix之新增、修改，寫入前各欄位之字串皆經wsemi之clearXSS清除(白名單外之標籤轉義，白名單內之標籤刪除白名單外之屬性與危險網址，標籤外之文字只轉義會開始標籤之<，故'a < b'等數學式不改寫)；select與del不經清除。
 * 字串主鍵若會被清除改寫(含HTML標記，如<後緊接英文字母)，整批reject且不寫入任何一筆(mix於任何步驟之前檢查新增與修改)，訊息列其位置而不回顯主鍵，如'failed to save data, id contains HTML markup: data[1]'；否則改寫後之主鍵與呼叫端所持者不同，以原主鍵查詢與刪除皆找不到。
 *
 * 多人同時編輯之寫入契約(規格見opensrcOper之dspec；規則帳本R-BASELINE-01、R-LOCK-01、R-ONLYMOD-01)：
 * (1)procOrm之第5參數opt(選用，既有四參數呼叫行為不變)，有兩個布林鍵：{ mustExist: true }只適用save與del，{ keepUserId: true }只適用insert(見下)；用於其餘mode、其餘鍵、非布林者於任何讀寫之前(含早於擴充函數check與前處理)reject，如'invalid opt of procOrm, mustExist supports only save and del'、'invalid opt of procOrm, keepUserId supports only insert'、'invalid opt of procOrm, keepUserId needs a boolean'。以下先述mustExist。save：寫入前以select(id $in)分批(每批至多1000個主鍵，避開各w-orm-*共用條件檢核之$in上限10000)檢查全部列(含補主鍵後)已存在，任一列不存在(含未帶主鍵者)即整批reject固定字串'rowNotFound'且零寫入，並轉傳autoInsert:false給ORM之save，使已刪除之列不復活；del：同樣先檢查，任一列不存在即整批零刪除並reject 'rowNotFound'，同批重複之主鍵整批reject 'invalid input of del, duplicate id: data[k]'(列其位置，零刪除)(未帶mustExist之del仍回ORM之逐筆結果，未命中為{n:0,nDeleted:0,ok:1}不視為錯誤)。檢查之後ORM仍回報逐筆未命中者(表鎖紀律被破壞)亦reject 'rowNotFound'，已寫入或刪除之筆無從回復。檢查與寫入非原子，呼叫端須已持有該表之表鎖(withTabLocks或guardWrite之write內)；檢查之select經ORM，ORM開啟useCache時可能非新鮮，故須同表只由同一ORM實例寫入且不開useCache，或於非快取之ORM實例執行。擴充函數(check、前後處理)之參數物件不含opt。w-orm-mdb之Jet比對不分大小寫且忽略尾端空白，而存在檢查以嚴格字串相等比對，於mdb可能把「ORM會命中」之列判為不存在而reject 'rowNotFound'(零寫入，為收嚴方向，非放寬)。keepUserId：insert預設把列上之userId(schema之keys含者)一律設為procOrm之第1參數(操作者)；當userId之語意為擁有者而非建立者(如sso之tokens.userId)，給{ keepUserId: true }則逐列保留自有、可列舉之資料屬性userId為非空字串者(單純空白字串亦屬之)，缺欄、空字串、null、非字串、繼承或不可列舉者仍以操作者補，保留之值仍經clearXSS；userIdUpdate、timeCreate、timeUpdate照現行(userIdUpdate恆為操作者)；表之keys不含userId者無效果；判定依據為前處理改寫後進入ORM之列；save現行即不覆寫列上之userId(只補userIdUpdate、timeUpdate)故不適用，mix之新增為內部步驟不開放；{ keepUserId: false }於各mode無效果。
 * (2)withTabLocks(tableNames, fn)：每個實例一個鎖管理器(wsemi之pmKeyMutex)，每表一鍵；tableNames為本實例資料表名之非空陣列(含不存在之表名者拋Error，避免拼錯而鎖到無人使用之鍵)，去重後依表名碼元序逐一取鎖(多表呼叫之取鎖順序固定，不死結)，取齊後執行fn(無參數)並回傳其結果，成敗皆釋放；fn之reject原樣轉出。不可重入：fn內不得再對同表呼叫withTabLocks或guardWrite(同鍵排隊等待自己，永不返回)，既有自行取鎖之函式不得再外包同鍵鎖；**巢狀取不同表亦有死結風險**：每次呼叫內雖依碼元序取鎖，跨層(fn內再呼叫)之次序不受控，一個呼叫先持b再等a、另一個先持a再等b即互等；故須一次宣告全部要用之表(如['users','tokens'])，不得於fn內再取其他表之鎖(若必須巢狀，所有呼叫路徑須依同一全域遞增次序)；逐列實體之業務鎖與表鎖並用時，先取表鎖、後取實體鎖。同表之所有寫入者(後台存檔、逐列寫入、外部同步、系統直寫雙方欄位)須共用同一實例之withTabLocks，鎖只在同一行程之同一實例內有效(多行程部署不在支援範圍)。
 * (3)guardWrite({ tables, read, baseline, contract, write })：withTabLocks(tables)內依序read()(呼叫端之新鮮讀取，須resolve陣列，不得經ORM快取)、compareBaseline(rows, baseline, contract)、write(rows)，回傳write之結果。baseline為undefined(不帶基準之寫入)時跳過比對但仍取鎖與讀取；null與其他非undefined之值皆比對，格式不合者reject 'baselineFormat'(不降級為不帶基準)。不符時reject一個Error：message與key皆為固定英文拒收鍵(baselineMismatch、rowNotFound、baselineFormat)，另附added、removed、changed(id陣列)與reordered(布林)供診斷，write不被呼叫。contract.table若有，須在tables內。write自身之reject(如procOrm之字串)原樣轉出，使用端以baseline.mjs之getRejectKey(err)取得拒收鍵(字串原樣、Error取其key、其餘為null)。同樣不可重入：write內勿再取鎖(同表重入、巢狀取他表之限制同withTabLocks)，須寫入時直接呼叫procOrm或woItems。write內寫入時，只可寫契約之pk與fields(客戶端欄位與雙方欄位)，伺服器專有欄位與系統欄位不得出現於寫入列(否則客戶端持舊列整列送出時會把系統已改之值回寫成舊值，規格V5)，可用baseline.mjs之pickWriteRow取白名單；整表存檔之刪除集合須為「基準內且在scope內之id − 送出之id」，不得用「庫內全部 − 送出」(會刪掉他人於載入後新增者，規格V8)。
 * (4)純函數子模組src/baseline.mjs(零import，可由瀏覽器端以w-serv-orm/src/baseline.mjs深層匯入)：digestRow、buildBaseline、compareBaseline、checkContract、isBaselineValid、cyrb53、pickWriteRow、getRejectKey，規則見該檔與README；不提供雜湊快取。
 *
 * 擴充函數(addFunCheck、addFunPreProcessing、addFunPostProcessing)屬於各實例，重建實例後須重新註冊；註冊時須傳入函數，否則立即拋錯(addFunCheck另令該實例之procOrm一律reject)；註冊後約1毫秒(以計時器)才生效，在此之前之procOrm呼叫不會套用。
 * 呼叫契約：check以reject或拋錯阻擋，回傳值不影響結果，且早於前處理執行；前處理逐一呼叫，各收新建之參數物件{woName,userId,mode,input}，input為前一個回傳之input，回傳須為含input之物件否則reject；後處理逐一呼叫，各收新建之參數物件且其output為前一個之回傳值，最後之回傳值即為procOrm之回傳值。
 * 後處理只在check、前處理與ORM操作皆成功後執行，逐筆失敗(含del)或mix部分寫入後reject者皆不執行；後處理自身亦可reject。後處理之input為前處理後之數據(無前處理者即呼叫端傳入之數據)，不含本套件之補值與主鍵轉型，主鍵見output。
 * 如需觀察ORM實際寫入，可另監聽woItems內各ORM之change與error事件；惟事件由ORM發出，不含userId，mix會依步驟分次發出，經woItems直接寫入者亦會發出，insert之結果為聚合計數而非逐筆。
 * 錯誤型別：procOrm由本套件產生之reject一律為英文訊息字串(供前端顯示或對應多語系；ORM之錯誤原文另由console.log輸出而不轉出；檢查與轉型階段之非預期例外，如使用端物件之Proxy陷阱拋錯、遞迴爆堆疊，統一為'failed to process input')，擴充函數自身之reject或拋錯則原樣轉出；建構(設定或ORM無效)、擴充函數註冊、backup與recover由本套件產生之錯誤一律為Error，ORM之錯誤則原樣轉出。
 *
 * 授權：procOrm不做授權，不檢查使用者，亦不依使用者過濾數據；userId只供寫入稽核欄位(userId、userIdUpdate)與交給擴充函數。procOrm開放給前端時(如讓前端經資料通道直接操作資料表)，須由開放處負責授權；addFunCheck可掛額外檢查，惟伺服端程式之呼叫亦會經過。
 * 已移除之設定：useCheckUser、getUserById、useExcludeWhenNotAdmin，未給、null或false者照常建構，給予其他值即於建構時拋錯。
 * 身分驗證責任(跨套件原則，見自有套件庫主控之 dspec「使用者身分驗證原則」)：自1.1.10起本套件不驗證token與使用者，傳入之userId一律視為使用方已完整驗證之身分；使用方(例如w-web-*之verifyConn與getUserIdByToken)須確認token有效、本系統使用者存在且啟用、通過部署方授權，並於函數層級檢查角色或成員。
 *
 * @class
 * @param {Object} ds 輸入資料表設定物件
 * @param {Object} WOrm 輸入資料庫ORM物件
 * @param {String} url 輸入資料庫連線位址字串
 * @param {String} db 輸入資料庫名稱字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}；目前無設定鍵，保留供日後擴充，已移除之設定見上述
 * @returns {Object} 回傳伺服器ORM支援物件，含woItems(各資料表ORM實例)、procOrm(資料操作函數，輸入為userId、woName、mode、input，及選用之opt)、withTabLocks(tableNames, fn)與guardWrite({ tables, read, baseline, contract, write })(見上述多人同時編輯之寫入契約)、addFunCheck、addFunPreProcessing、addFunPostProcessing、closeAll(逐一關閉各資料表ORM之連線)，以及backup(woItems)與recover(fp, woItems, genModels, needCreateStorage)；後兩者不綁定本實例，須自行傳入woItems(須為非空物件，否則reject)，其參數順序與getDb之recover(woItems, fp, opt)不同；recover於寫入前驗證備份內容(須為非空陣列且各筆之name為woItems內之資料表)，失敗時reject，逐表寫入時中途失敗則先前之表已寫入
 * @example
 *
 * // import WOrm from 'w-orm-mongodb/src/WOrmMongodb.mjs' //自行選擇引用ORM
 * import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs' //自行選擇引用ORM
 * import ds from './schema/index.mjs' //先行建置schema
 * import WServOrm from './src/WServOrm.mjs'
 *
 * // //st
 * // let st = {
 * //     dbUsername: 'username',
 * //     dbPassword: 'password',
 * //     dbName: 'wservorm',
 * //     dbIP: 'localhost',
 * //     dbPort: 27017,
 * // }
 *
 * //url, db
 * // let url = `mongodb://${st.dbUsername}:${st.dbPassword}@${st.dbIP}:${st.dbPort}`
 * // let db = st.dbName
 * let url = './db.json'
 * let db = 'worm'
 *
 * //WServOrm
 * let r = WServOrm(ds, WOrm, url, db)
 * console.log(r) //回傳server用orm相關函數
 * // => {
 * //   backup: [AsyncFunction: backup],
 * //   recover: [AsyncFunction: recover],
 * //   woItems: {
 * //     tests: EventEmitter {
 * //       _events: [Object: null prototype] {},
 * //       _eventsCount: 0,
 * //       _maxListeners: undefined,
 * //       select: [AsyncFunction: select],
 * //       insert: [AsyncFunction: insert],
 * //       save: [AsyncFunction: save],
 * //       del: [AsyncFunction: del],
 * //       delAll: [AsyncFunction: delAll],
 * //       selectGfs: [AsyncFunction: selectGfs],
 * //       insertGfs: [AsyncFunction: insertGfs],
 * //       delGfs: [AsyncFunction: delGfs],
 * //       delAllGfs: [AsyncFunction: delAllGfs],
 * //       [Symbol(kCapture)]: false
 * //     }
 * //   },
 * //   closeAll: [AsyncFunction: closeAll],
 * //   addFunCheck: [Function: addFunCheck],
 * //   addFunPreProcessing: [Function: addFunPreProcessing],
 * //   addFunPostProcessing: [Function: addFunPostProcessing],
 * //   procOrm: [AsyncFunction: procOrm]
 * // }
 *
 * // export default r
 *
 */
function WServOrm(ds, WOrm, url, db, opt = {}) {

    //checkOptRemoved, 須於建立各資料表ORM之前, 否則拋錯時已開啟之ORM(如lmdb之檔案)無從關閉; getProc收到opt時會再檢查一次, 無副作用
    checkOptRemoved(opt)

    //getWoItems
    let woItems = getWoItems(ds, WOrm, url, db)
    // console.log('woItems', woItems)

    //getMapOrm
    let mapOrm = getMapOrm(ds, woItems)
    // console.log('mapOrm', mapOrm)

    //getProc
    let proc = getProc(mapOrm, opt)
    // console.log('proc', proc)

    //closeAll, 逐一關閉woItems內各資料表ORM實例之連線(env), 釋放檔案鎖, 供測試隔離或優雅關機使用
    let closeAll = async () => {
        await pmSeries(woItems, async (wo) => {
            if (wo && isfun(wo.close)) { //ORM未實作close時(如lowdb)自動略過
                await wo.close()
            }
        })
    }

    //kmx, 每實例一個鎖管理器(每表一鍵), 同表之寫入者須共用(R-LOCK-01)
    let kmx = pmKeyMutex()

    //withTabLocks, 依表名碼元序逐一取鎖後執行fn; 不可重入(說明見上方JSDoc)
    let withTabLocks = async (tableNames, fn) => {
        let ts = getTabsLock(woItems, tableNames, fn)
        let run = fn
        for (let k = ts.length - 1; k >= 0; k--) {
            let inner = run
            let key = ts[k]
            run = () => kmx(key, inner)
        }
        return run()
    }

    //guardWrite, 取鎖 -> 新鮮讀取 -> 比對 -> 寫入, 同一表鎖內(說明見上方JSDoc)
    let guardWrite = async (p) => {
        if (p === null || typeof p !== 'object') {
            throw new Error('invalid input of guardWrite, need an object')
        }
        let { tables, read, baseline, contract, write } = p
        if (!isfun(read)) {
            throw new Error('invalid read of guardWrite, need a function')
        }
        if (!isfun(write)) {
            throw new Error('invalid write of guardWrite, need a function')
        }

        //contract, 帶基準時必須有; 未帶基準而給了契約者仍驗證(及早發現使用端之錯誤)
        let useBaseline = baseline !== undefined
        if (useBaseline || contract !== undefined) {
            checkContract(contract)
            if (typeof contract.table === 'string' && !(Array.isArray(tables) && tables.indexOf(contract.table) >= 0)) {
                throw new Error('invalid tables of guardWrite, need to contain contract.table')
            }
        }

        return withTabLocks(tables, async () => {
            let rows = await read()
            if (!Array.isArray(rows)) {
                throw new Error('invalid rows of guardWrite, read needs to resolve an array')
            }
            if (useBaseline) {
                let c = compareBaseline(rows, baseline, contract)
                if (!c.ok) {
                    throw mkErrBaseline(c)
                }
            }
            return await write(rows)
        })
    }

    return {
        ...getDbBackupAndRecover,
        woItems,
        // mapOrm,
        closeAll,
        withTabLocks,
        guardWrite,
        ...proc,
    }
}


export default WServOrm
