import { types } from 'util'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import take from 'lodash-es/take.js'
import join from 'lodash-es/join.js'
import truncate from 'lodash-es/truncate.js'
import nowms2str from 'wsemi/src/nowms2str.mjs'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import clearXSS from 'wsemi/src/clearXSS.mjs'
import getItemsFail from 'w-data-collector/src/getItemsFail.mjs'
import isOrmFail from './isOrmFail.mjs'
import { getOptLog, getDiag, getBriefErr, getBriefFails, getBriefResult, getBriefType, cpDetail } from './getDiag.mjs'


//MODES_PROC, procOrm之mode全集: 邊界catch之標籤只放行這些固定值(R-DIAG-01)
const MODES_PROC = ['select', 'insert', 'save', 'del', 'delAll', 'mix']


function getMsgFail(msg, fails) {
    //前端訊息僅列出失敗筆, 錯誤原文另由診斷輸出(diag, 預設只列筆數與位置, 見R-DIAG-01)輸出, 與既有整批錯誤之處理一致
    //有效主鍵(非空字串或數字)列為id[...], 否則列其於輸入內之位置, 失敗筆數過多時僅列前nShow筆並附總筆數
    //呼叫端給予位置標籤ref者(如mix同鍵之add[0])原樣列出
    //主鍵超過nIdMax字元者截斷顯示(LMDB逐筆失敗常因主鍵超長, 故兩者常同時出現), log仍保留全文

    //nShow, nIdMax
    let nShow = 10
    let nIdMax = 100

    //ss
    let ss = map(take(fails, nShow), (v) => {
        if (isestr(v.ref)) {
            return v.ref
        }
        if (isestr(v.id) || isnum(v.id)) {
            return `id[${truncate(String(v.id), { length: nIdMax, omission: '…' })}]`
        }
        return `data[${v.k}]`
    })

    //c
    let c = `${msg}: ${join(ss, ', ')}`
    if (size(fails) > nShow) {
        c += `, ... (${size(fails)} in total)`
    }

    return c
}


function isPkIdString(dsTab, keys) {
    //資料表之主鍵欄是否為id且可容納字串型之補值, 供adjustData判斷是否補主鍵

    //check, 須有id欄; 有settings者另須標為pk
    if (keys.indexOf('id') < 0) {
        return false
    }
    let settings = get(dsTab, 'settings', null)
    if (iseobj(settings) && get(settings, 'id.pk') !== true) {
        return false
    }

    //check, 型別已知者須為字串型, 與w-orm-reladb可自動補值之主鍵欄型別一致
    //比對前取「(」之前之字並轉大寫, 如STRING(36)視為STRING, 同w-orm-reladb以type.key判定而不含長度參數
    let type = get(settings, 'id.type', '') || get(dsTab, 'kpType.id', '')
    if (isestr(type) && ['STRING', 'TEXT', 'CHAR', 'UUID', 'CITEXT'].indexOf(type.split('(')[0].trim().toUpperCase()) < 0) {
        return false
    }

    return true
}


function getOwnItem(o, k) {
    //取o之自有屬性k, 非自有、k非字串、o非物件或值為undefined者回傳null(R-INPUT-01 規則5)
    //不用lodash get: 其會取到原型鏈上之值(__proto__、constructor、toString等)並解析路徑字串(如'tests.select'取到ORM之函數); 鍵本身含「.」者為自有屬性, 照常
    if (o === null || typeof o !== 'object' || typeof k !== 'string' || !Object.prototype.hasOwnProperty.call(o, k)) {
        return null
    }
    return o[k] === undefined ? null : o[k]
}


function isArr(v) {
    //是否為真陣列(Array.isArray, 不用wsemi isarr: 其以Object.prototype.toString判定, 可被Symbol.toStringTag宣稱而走訪其length getter, R-OBJ-01 規則7 ④)
    //已撤銷之Proxy使Array.isArray拋TypeError, 視為非陣列(由列檢查以irregular回報, 不觸發陷阱)
    try {
        return Array.isArray(v)
    }
    catch (e) {
        return false
    }
}


function isAcc(d) {
    //描述子是否為存取器: 以有無value欄位判斷, 不以get/set是否非undefined(get與set皆為undefined之存取器 Object.defineProperty(o, 'id', { get: undefined, set: undefined, enumerable: true }) 亦為存取器)
    return !Object.prototype.hasOwnProperty.call(d, 'value')
}


function isIdCast(ds, woName) {
    //資料表之主鍵欄為字串型或型別未知者, 主鍵之有限數字以其字串形式處置(R-ID-02); ds無該表者不轉型, 令select與del照舊原樣交ORM
    let dsTab = getOwnItem(ds, woName)
    let keys = get(dsTab, 'keys', null)
    if (!isarr(keys)) {
        return false
    }
    return isPkIdString(dsTab, keys)
}


function isIdNumFinite(v) {
    //主鍵值是否為有限數字, 不用wsemi之isnum: 其對數字字串與Infinity亦為true
    return typeof v === 'number' && Number.isFinite(v)
}


function castIdValue(v) {
    //主鍵值之正規化: 有限數字轉為其字串形式, 其餘原樣(NaN、±Infinity亦原樣, 寫入時由adjustData視為未提供而補值)
    //各後端之主鍵判準互異, lmdb、lowdb、level、mongodb只認非空字串而以genIDSeq取代數字, reladb、mdb之字串欄由資料庫把數字存為字串,
    //故由本套件先轉, 令寫入、刪除與查詢條件同一規則, 回傳之主鍵與實際寫入者一致
    return isIdNumFinite(v) ? String(v) : v
}


function mapOwn(o, f) {
    //使用端物件之複製與逐鍵轉換(R-OBJ-01 規則1、2): 只走自有可列舉鍵, 回傳新物件, f收(值, 鍵)
    //不用lodash each: 其對具非負整數length鍵之物件(如{length:1,name:'x'})採陣列樣迭代, 只走索引0..length-1而丟棄全部自有鍵
    //以fromEntries建立自有屬性, 不用r[k]=v: k為__proto__時會改設r之原型而不建立自有屬性
    return Object.fromEntries(Object.keys(o).map((k) => [k, f(o[k], k)]))
}


//不支援之鍵或屬性的原因與訊息(R-OBJ-01 規則3、5、5續、6、7), 訊息只列固定字句, 不回顯客戶端之值
const MSGS_BAD_KEY = Object.freeze({
    proto: 'unsupported key[__proto__]',
    accessor: 'unsupported accessor property',
    unreadable: 'unreadable value',
    deep: 'too deep',
    large: 'too large',
    sparse: 'unsupported sparse array',
    hidden: 'unsupported symbol key or non-enumerable property',
    irregular: 'unsupported irregular object or array',
})

//find之巢狀深度上限, 以容器(一般物件與陣列)層數計, 根為第1層(R-OBJ-01 規則5)
//castIdFind以遞迴處理$and、$or, 遞迴深度即呼叫堆疊深度, 實測字串型主鍵表約1173層$and(約2346個容器)起爆堆疊;
//64個容器層約為32層邏輯巢狀, 遠大於合理查詢(庫內最深約7個容器)而遠小於爆堆疊之閾值
const MAX_DEPTH_FIND = 64

//原型鏈長度上限(isCleanChain; R-OBJ-01 規則6、7)
const MAX_CHAIN = 64

//find展開後之物件總數上限(不含陣列; 共用子結構依出現次數重複計, R-OBJ-01 規則5續)
//getReasonBadKey以seen去重而castIdFind依路徑展開, 指數型共用子結構(x_{i+1}={$and:[x_i,x_i]})k層展開2^(k+1)-1個物件, 實測k=22約5.7秒、+762MB, 256MB堆積下k=22即OOM崩潰(無法catch);
//與wsemi cvOrmFind之maxNodes(100000)同值且口徑為其子集: 後端計節點(條件物件、運算子物件、純量各計1, $and/$or之陣列不計), 本層只計物件, 故凡本層因逾此值拒收者後端必也拒收, 本層不拒收後端會接受者
//(castIdFind只經物件遞迴$and、$or之元素, 陣列元素不展開, 故不計陣列仍足以限制其展開量)
const MAX_NODES_FIND = 100000

//find之字串碼元總長(字串值與物件鍵, 含重複出現者)逾此值不做整棵結構化複製, 改走精確品牌探針(R-OBJ-01 規則6 ⑥)
//structuredClone對重複出現之字串每次皆寫出並讀回, 記憶體與(字串碼元總長 x 出現次數)成正比, 同一64KB字串於$in內重複1萬次即邏輯長度655M碼元; 與wsemi cvOrmFind之CLONE_MAX_CHARS同值
const MAX_CHARS_CLONE = 4000000

//拒收之診斷快照的上限: 值個數(含葉)、層數、每層鍵或元素數、字串長度(R-OBJ-01 規則6 ⑤)
const SNAP_MAX_NODES = 200
const SNAP_MAX_DEPTH = 8
const SNAP_MAX_ITEMS = 50
const SNAP_MAX_STR = 200

//WeakRef、FinalizationRegistry之精確品牌探針(R-OBJ-01 規則6 ⑥): util.types無對應判定, 後端cvOrmFind亦以此二探針reject;
//於模組載入時取得內建方法(不受其後全域覆寫影響), 對非該品牌之值拋TypeError, 不執行使用端程式
const weakRefDeref = typeof WeakRef === 'function' ? Function.prototype.call.bind(WeakRef.prototype.deref) : null
const frUnregister = typeof FinalizationRegistry === 'function' ? Function.prototype.call.bind(FinalizationRegistry.prototype.unregister) : null
const probeToken = {}


function isCleanChain(o) {
    //o及其原型鏈上無Proxy、且無任何自有Symbol.toStringTag(R-OBJ-01 規則6): 全程只用util.types.isProxy(不觸發陷阱)、Object.getPrototypeOf與自有屬性查詢(不讀值),
    //故不執行使用端程式(Proxy之陷阱、標籤getter); 不用in運算子: 其遇Proxy原型會執行has陷阱, 令檢查之值與使用之值可不同(外審第二輪 A-02)
    //原型鏈長度逾MAX_CHAIN者視為不乾淨(合法物件之原型鏈至多數層), 令每次分類之成本有界: 共用陣列帶P層原型而被引用E次時, measureFind與castIdFind之分類為E x P(外審 sol F08)
    let n = 0
    for (let x = o; x !== null; x = Object.getPrototypeOf(x)) {
        if (n++ > MAX_CHAIN || types.isProxy(x) || Object.prototype.hasOwnProperty.call(x, Symbol.toStringTag)) {
            return false
        }
    }
    return true
}


function isBrandObj(o) {
    //內建品牌物件與其他非容器之內建物件(R-OBJ-01 規則6): 內部槽不在自有鍵中, 原型被改為null或Object.prototype而無標籤可辨時, 會被mapOwn洗成{};
    //以util.types判定(不受原型與標籤影響, 不執行使用端程式)為主要探針; 未涵蓋者(WeakRef、FinalizationRegistry、Blob等)由hasIrregularClone之結構化複製網補
    return types.isMap(o) || types.isSet(o) || types.isWeakMap(o) || types.isWeakSet(o) || types.isPromise(o) ||
        types.isAnyArrayBuffer(o) || types.isArrayBufferView(o) || types.isBoxedPrimitive(o) || types.isRegExp(o) || types.isNativeError(o) ||
        types.isGeneratorObject(o) || types.isMapIterator(o) || types.isSetIterator(o) || types.isModuleNamespaceObject(o)
}


function isRealmObjectProto(p) {
    //p是否為某realm之Object.prototype(R-OBJ-01 規則6, 跨realm之純物件用): 原型為null、自有鍵名集合同本realm之Object.prototype、constructor為(資料屬性之)函數且其原始碼同Object,
    //且該函數之prototype指回p; 只有constructor一鍵、或鍵名同而constructor指向他處(含getter)之偽原型皆不通過; 全程以屬性描述子讀取, 不執行使用端程式(p已由isCleanChain確認非Proxy)
    if (Object.getPrototypeOf(p) !== null) {
        return false
    }
    let ks0 = Reflect.ownKeys(Object.prototype)
    if (Reflect.ownKeys(p).length !== ks0.length) {
        return false
    }
    for (let k of ks0) {
        if (!Object.prototype.hasOwnProperty.call(p, k)) {
            return false
        }
    }
    let d = Object.getOwnPropertyDescriptor(p, 'constructor')
    if (d === undefined || typeof d.value !== 'function' || types.isProxy(d.value)) {
        return false
    }
    if (Function.prototype.toString.call(d.value) !== Function.prototype.toString.call(Object)) {
        return false
    }
    let dp = Object.getOwnPropertyDescriptor(d.value, 'prototype')
    return dp !== undefined && dp.value === p
}


function isPlainObj(v) {
    //純物件(R-INPUT-01 規則3、R-OBJ-01 規則6): 無Proxy與Symbol.toStringTag(原型鏈上皆不得有, 見isCleanChain)、isobj為真,
    //且原型為null、本realm之Object.prototype,或某realm之Object.prototype(isRealmObjectProto, 故跨realm(vm)之物件通過)
    //類別實例、Object.create(proto)、原型為null原型之一般物件、宣稱Symbol.toStringTag之Map或包裝物件, 其自有可列舉鍵可能為空而被複製成{}, 令條件消失, 故不算
    if (typeof v !== 'object' || v === null || !isCleanChain(v) || !isobj(v)) {
        return false
    }
    let p = Object.getPrototypeOf(v)
    return p === null || p === Object.prototype || isRealmObjectProto(p)
}


function getKindFind(o) {
    //find節點之分類(R-OBJ-01 規則6), 檢查(getReasonBadKey strict)與複製(castIdFind、castIdCond)共用同一判準, 使複本與原物件在後端所見等價:
    //  'arr': 真陣列(Array.isArray); 'obj': 一般物件(isobj); null: 不是容器, 原值或原參考交後端(原始值、函數、Date等)
    //有Proxy、有Symbol.toStringTag(自有或繼承)、或為內建品牌物件者不分類(null), 由檢查reject: 以isCleanChain判斷而不讀標籤、不觸發陷阱,
    //故不執行使用端程式, 亦不致檢查與複製各讀一次而得不同結果
    if (typeof o !== 'object' || o === null || !isCleanChain(o) || isBrandObj(o)) {
        return null
    }
    if (Array.isArray(o)) {
        return 'arr'
    }
    return isobj(o) ? 'obj' : null
}


function hasIrregularClone(v) {
    //品牌物件之通用網(R-OBJ-01 規則6): 以一次結構化複製證明v之容器皆為一般物件、陣列或Date; isBrandObj(util.types)已涵蓋常見內建品牌物件, 此網補其餘(Blob、WeakRef、FinalizationRegistry、Intl.*等):
    //複製拋錯(Proxy、WeakRef、FinalizationRegistry、函數值、Symbol值等),或複本之容器原型不是Object.prototype、Array.prototype、Date.prototype(Blob等複製後仍為原品牌, 含原型被改為null者,
    //其內部槽不在自有鍵中, 無標籤可辨, 又會被mapOwn洗成{})者, 回傳true; 呼叫時v已確認無Proxy與存取器(複製不執行使用端程式)
    if (typeof structuredClone !== 'function') {
        return false //執行環境無結構化複製(Node 17以前)則無此網(呼叫端getReasonBadKey此時改走hasWeakSlot之精確探針)
    }
    let c
    try {
        c = structuredClone(v)
    }
    catch (e) {
        return true
    }
    let seen = new Set()
    let stack = [c]
    while (stack.length > 0) {
        let o = stack.pop()
        if (typeof o !== 'object' || o === null || seen.has(o)) {
            continue
        }
        seen.add(o)
        let p = Object.getPrototypeOf(o)
        if (p === Date.prototype) {
            continue
        }
        if (p !== Object.prototype && p !== Array.prototype) {
            return true
        }
        for (let k of Object.keys(o)) {
            stack.push(o[k])
        }
    }
    return false
}


function hasWeakSlot(o) {
    //o是否為WeakRef或FinalizationRegistry(R-OBJ-01 規則6 ⑥, 品牌網逾字元預算或無structuredClone時用): 以內建方法之品牌檢查判斷, 非該品牌即拋TypeError; 呼叫時o已確認非Proxy
    if (weakRefDeref !== null) {
        try {
            weakRefDeref(o)
            return true
        }
        catch (e) {
            //非WeakRef
        }
    }
    if (frUnregister !== null) {
        try {
            frUnregister(o, probeToken)
            return true
        }
        catch (e) {
            //非FinalizationRegistry
        }
    }
    return false
}


function snapSafe(v, st = { n: 0 }, depth = 0) {
    //診斷輸出用之安全快照(R-OBJ-01 規則6 ⑤): 回傳本層新建之純資料, 全程只用型別探針(util.types)與屬性描述子, 不呼叫getter、不讀Symbol.toStringTag、不觸發Proxy陷阱、不呼叫util.inspect.custom,
    //故console.log格式化的是快照而非使用端物件(原以console.log輸出原物件時, 格式化會在拒收之後執行使用端程式, 其副作用可改動呼叫端的find);
    //Proxy、函數、Symbol、品牌物件、存取器與Date以固定字樣代替, 不可列舉鍵加註, 並有值個數(含葉)、層數、每層項數與字串長度之上限(診斷輸出不隨輸入放大)
    if (st.n >= SNAP_MAX_NODES) {
        return '[...]'
    }
    st.n++
    if (typeof v === 'string') {
        return truncate(v, { length: SNAP_MAX_STR })
    }
    if (typeof v === 'function') {
        return '[Function]'
    }
    if (typeof v === 'symbol') {
        return '[Symbol]'
    }
    if (typeof v !== 'object' || v === null) {
        return v
    }
    if (types.isProxy(v)) {
        return '[Proxy]'
    }
    if (types.isDate(v)) {
        return '[Date]'
    }
    if (isBrandObj(v)) {
        return '[Object]'
    }
    if (depth >= SNAP_MAX_DEPTH) {
        return '[...]'
    }
    let snapDesc = (d) => {
        if (d === undefined) {
            return '[empty]'
        }
        if (isAcc(d)) {
            return '[Getter/Setter]'
        }
        return snapSafe(d.value, st, depth + 1)
    }
    if (Array.isArray(v)) {
        let n = Math.min(v.length, SNAP_MAX_ITEMS)
        let rs = []
        for (let i = 0; i < n; i++) {
            rs.push(snapDesc(Object.getOwnPropertyDescriptor(v, i)))
        }
        if (v.length > n) {
            rs.push(`[${v.length - n} more]`)
        }
        return rs
    }
    let ks = Reflect.ownKeys(v)
    let r = {}
    for (let k of ks.slice(0, SNAP_MAX_ITEMS)) {
        let d = Object.getOwnPropertyDescriptor(v, k)
        let name = typeof k === 'symbol' ? String(k) : k
        Object.defineProperty(r, d.enumerable ? name : `${name} (non-enumerable)`, { value: snapDesc(d), enumerable: true, writable: true, configurable: true })
    }
    if (ks.length > SNAP_MAX_ITEMS) {
        Object.defineProperty(r, '[more]', { value: ks.length - SNAP_MAX_ITEMS, enumerable: true, writable: true, configurable: true })
    }
    return r
}


function logFind(diag, label, errFind, input) {
    //被拒之find的診斷輸出(R-OBJ-01 規則6 ⑤、R-DIAG-01): 預設只輸出拒收原因(固定句型, 不含條件值); 細節(logDetail為true或funLog收到者)為snapSafe之快照而非原物件, 不執行使用端程式
    diag(label, { reason: errFind }, () => {
        try {
            return snapSafe(input)
        }
        catch (e) {
            return '(unprintable)'
        }
    })
}


function getRowId(row) {
    //寫入列(及mix之del列)之主鍵值: 只認自有、可列舉之資料屬性, 其餘(不可列舉、繼承、存取器、無此屬性)視為未提供, 不執行任何getter
    //與adjustData之mapOwn(只複製自有可列舉鍵)一致, 令本套件所見之id即實際寫入之id
    if (typeof row !== 'object' || row === null) {
        return undefined
    }
    let d = Object.getOwnPropertyDescriptor(row, 'id')
    if (d === undefined || !d.enumerable || isAcc(d)) {
        return undefined
    }
    return d.value
}


function hasOwnerUserId(row) {
    //寫入列上之userId是否為擁有者: 只認自有、可列舉之資料屬性且為非空字串(與getRowId同一認定, 不執行getter), 其餘(缺欄、空字串、非字串、繼承、不可列舉)視為未提供
    if (typeof row !== 'object' || row === null) {
        return false
    }
    let d = Object.getOwnPropertyDescriptor(row, 'userId')
    return d !== undefined && d.enumerable && !isAcc(d) && typeof d.value === 'string' && d.value !== ''
}


//procOrm第5參數opt允許之鍵(R-ONLYMOD-01、R-KEEPUSER-01), 皆為布林
const OPT_KEYS_PROC = ['mustExist', 'keepUserId']

//mustExist之存在檢查每次select之主鍵數上限(R-ONLYMOD-01 規則 11)
const EXIST_CHUNK = 1000


function getOptProc(mode, opt) {
    //procOrm之第5參數opt: 未給(undefined、null)為空設定; 否則須為純物件且只含mustExist、keepUserId(皆布林), 其餘鍵、存取器、非布林者於任何讀寫之前reject
    //拼錯之鍵(如mustexist)若被靜默忽略, 會令只改不增失效而重新長出已刪之列(keepUserId拼錯則擁有者被覆寫成操作者), 故fail-closed; 訊息不回顯呼叫端之值
    //mustExist只適用save與del; keepUserId只適用insert(save現行即不覆寫userId, mix之新增為內部步驟不開放); 先逐一驗型別再驗mode, 結果與鍵之次序無關
    let bad = (err) => ({ err, mustExist: false, keepUserId: false })
    if (opt === undefined || opt === null) {
        return { err: null, mustExist: false, keepUserId: false }
    }
    if (!isPlainObj(opt)) {
        return bad('invalid opt of procOrm, need an object')
    }
    for (let k of Reflect.ownKeys(opt)) {
        if (OPT_KEYS_PROC.indexOf(k) < 0) {
            return bad('invalid opt of procOrm, unsupported key')
        }
    }
    let flags = { mustExist: false, keepUserId: false }
    for (let key of OPT_KEYS_PROC) {
        let d = Object.getOwnPropertyDescriptor(opt, key)
        if (d !== undefined) {
            if (isAcc(d) || typeof d.value !== 'boolean') {
                return bad(`invalid opt of procOrm, ${key} needs a boolean`)
            }
            flags[key] = d.value
        }
    }
    if (flags.mustExist && mode !== 'save' && mode !== 'del') {
        return bad('invalid opt of procOrm, mustExist supports only save and del')
    }
    if (flags.keepUserId && mode !== 'insert') {
        return bad('invalid opt of procOrm, keepUserId supports only insert')
    }
    return { err: null, mustExist: flags.mustExist, keepUserId: flags.keepUserId }
}


async function hasMissingRow(wo, rows) {
    //rows(寫入或刪除之列)是否有任一列不存在於資料表(含無有效主鍵者: 無從識別即視為不存在), 以select(id $in)分批查詢; true為有缺
    //只認自有可列舉之資料屬性之id(getRowId), 與寫入與刪除實際使用之id同一; 比對以字串形式(整數主鍵與其字串視為同一)
    //此讀取為ORM之select, ORM開啟useCache時可能非新鮮, 屬部署前提(單一行程、同表同一ORM實例、不經快取), 見規則帳本R-ONLYMOD-01
    let ids = []
    let seen = new Set()
    for (let v of (isArr(rows) ? rows : [rows])) {
        let id = getRowId(v)
        if (!((typeof id === 'string' && id !== '') || isIdNumFinite(id))) {
            return true
        }
        if (!seen.has(String(id))) {
            seen.add(String(id))
            ids.push(id)
        }
    }
    //分批查詢: 各w-orm-*共用之條件檢核(wsemi cvOrmFind)限$in之元素數(預設10000, 只可下調), 超過者整批reject; 每批EXIST_CHUNK個, 任一批有缺即止
    for (let k = 0; k < ids.length; k += EXIST_CHUNK) {
        let part = ids.slice(k, k + EXIST_CHUNK)
        let rs = await wo.select({ id: { $in: part } })
        let found = new Set(map(isArr(rs) ? rs : [], (r) => String(get(r, 'id'))))
        if (part.some((id) => !found.has(String(id)))) {
            return true
        }
    }
    return false
}


function getItemsDupId(rows) {
    //mustExist之del: 同批重複之有效主鍵(第2次以後出現者)之位置[{k}]; 無效主鍵者不計(由存在檢查處置)
    //重複者若放行, 第1筆刪除後第2筆必未命中, 事後偵測雖會reject卻已刪除, 違反[任一列不存在即零刪除], 故於刪除之前整批拒絕
    let seen = new Set()
    let rs = []
    let arr = isArr(rows) ? rows : [rows]
    for (let k = 0; k < arr.length; k++) {
        let id = getRowId(arr[k])
        if (!((typeof id === 'string' && id !== '') || isIdNumFinite(id))) {
            continue
        }
        let s = String(id)
        if (seen.has(s)) {
            rs.push({ k })
        }
        else {
            seen.add(s)
        }
    }
    return rs
}


function hasNoHit(r, keyDel) {
    //ORM之逐筆結果是否有已正常處理(ok非0)而未命中者(n為0; keyDel非null者另認該鍵為0, 如del之nDeleted): 表鎖紀律被破壞(檢查後、寫入前列被他方刪除)時之事後偵測
    return (isArr(r) ? r : [r]).some((x) => {
        return x !== null && typeof x === 'object' && x.ok !== 0 && (x.n === 0 || (keyDel !== null && x[keyDel] === 0))
    })
}


function firstBadIndex(a) {
    //陣列首個空洞或存取器索引, 回傳[索引, 'sparse'|'accessor'], 無則null; 成本為該索引之位置, 稀疏巨陣列於索引0即返回
    //索引為存取器者, 其後各步驟(each、map以array[index]讀取)會執行使用端程式並可每次回傳不同列(外審 sol F01)
    for (let i = 0; i < a.length; i++) {
        let d = Object.getOwnPropertyDescriptor(a, i)
        if (d === undefined) {
            return [i, 'sparse']
        }
        if (isAcc(d)) {
            return [i, 'accessor']
        }
    }
    return null
}


function getKidsFind(o) {
    //容器o之容器子節點(依出現次數, 含重複); 呼叫時find已通過strict檢查(只含乾淨之純物件與密陣列, 無存取器), 故可直接以描述子讀值
    let rs = []
    let ks = Array.isArray(o) ? null : Object.keys(o)
    let n = ks === null ? o.length : ks.length
    for (let i = 0; i < n; i++) {
        let v = Object.getOwnPropertyDescriptor(o, ks === null ? i : ks[i]).value
        if (getKindFind(v) !== null) {
            rs.push(v)
        }
    }
    return rs
}


function measureFind(root, maxDepth, maxNodes) {
    //find之最長路徑深度(容器=物件與陣列)與展開後物件數(不含陣列; 共用子結構依出現次數重複計), 通過回傳null, 逾上限回傳'deep'(含循環)或'large'(R-OBJ-01 規則5續)
    //getReasonBadKey以seen去重而只計首次到達之深度, 共用子結構(DAG)可繞過maxDepth, 且castIdFind依路徑展開, 指數型DAG展開2^k個物件
    //作法: 顯式堆疊之記憶化後序走訪, 每個容器只展開一次(O(節點+邊)); 堆疊深度不超過maxDepth+1(逾即返回); 展開數於逾maxNodes即返回, 不產生大數
    let st = new Map() //容器 -> -1(走訪中, 遇到即為循環) | 展開後容器數(已完成)
    let dep = new Map() //容器 -> 以其為根之最長路徑容器數
    let stack = [{ o: root, kids: getKidsFind(root), i: 0, d: 0, n: Array.isArray(root) ? 0 : 1 }]
    st.set(root, -1)
    while (stack.length > 0) {
        let f = stack[stack.length - 1]
        if (stack.length > maxDepth) {
            return 'deep'
        }
        if (f.i < f.kids.length) {
            let c = f.kids[f.i++]
            let s = st.get(c)
            if (s === undefined) {
                st.set(c, -1)
                stack.push({ o: c, kids: getKidsFind(c), i: 0, d: 0, n: Array.isArray(c) ? 0 : 1 })
            }
            else if (s === -1) {
                return 'deep'
            }
            else {
                f.n += s
                f.d = Math.max(f.d, dep.get(c))
                if (f.n > maxNodes) {
                    return 'large'
                }
                if (stack.length + dep.get(c) > maxDepth) {
                    return 'deep'
                }
            }
        }
        else {
            stack.pop()
            st.set(f.o, f.n)
            dep.set(f.o, f.d + 1)
            if (stack.length > 0) {
                let p = stack[stack.length - 1]
                p.n += f.n
                p.d = Math.max(p.d, f.d + 1)
                if (p.n > maxNodes) {
                    return 'large'
                }
                if (stack.length + dep.get(f.o) > maxDepth) {
                    return 'deep'
                }
            }
        }
    }
    return null
}


function getReasonBadKey(v, maxDepth = Infinity, strict = false) {
    //v之任何深度(一般物件之值、陣列之元素)含不支援之鍵或屬性者回傳原因(R-OBJ-01 規則3、5、6), 通過回傳null:
    //  proto: 含自有__proto__鍵, 不論可否列舉; 自有鍵可由JSON.parse、Object.fromEntries、展開、structuredClone等產生, 物件字面量之__proto__為設原型而不算
    //  accessor: 含存取器屬性(getter或setter), 其值每讀一次可能不同, 令檢查之值與使用之值無法保證相同, 且讀取可能有副作用
    //  unreadable: 檢查時拋錯, 如Proxy之陷阱或已撤銷之Proxy
    //  sparse: 陣列有空洞(寫入列; 逐索引迴圈對稀疏巨陣列近乎不終止, 其後clearXSS又把空洞展成密陣列, 規則7 ⑤; find之strict路徑同樣拒收但回irregular)
    //  deep: 容器(一般物件與陣列)層數超過maxDepth(根為第1層), 走訪到第maxDepth+1層即停止; 只有find給予maxDepth, 寫入列不設上限(見R-OBJ-01 規則5)
    //  large、deep(共用子結構與循環): strict走訪全數通過後由measureFind判定最長路徑與展開後容器數(規則5續), 因seen去重只計首次到達之深度
    //strict(只有find開啟, 規則6): castIdFind、castIdCond以mapOwn(只走自有可列舉字串鍵)與lodash map(只走索引)複製find, 複本會洗掉下列結構,
    //令後端白名單版本會reject之條件變成較寬甚至無條件(delAll刪全表), 故走訪到之每個節點須為複本與原物件等價者, 容器之分類與複製共用getKindFind:
    //  irregular: 有Symbol.toStringTag(原型鏈上任一層之自有屬性, 含內建品牌物件與宣稱標籤者, 以hasOwnProperty判斷而不讀取)、物件節點非純物件(類別實例、偽原型等, 同頂層之isPlainObj)、
    //    陣列節點有空洞、不可列舉元素或額外屬性(含Symbol鍵), 或結構化複製證明有品牌物件與不可複製者(Proxy、函數值等, 見hasIrregularClone);
    //    字串碼元總長逾MAX_CHARS_CLONE或無structuredClone時不做結構化複製, 改以hasWeakSlot逐一探針WeakRef與FinalizationRegistry(規則6 ⑥)
    //  hidden: 物件節點有Symbol鍵或不可列舉鍵
    //寫入列不開strict: 後端自己亦略過Symbol鍵與不可列舉鍵, 複本不改變其語意
    //只走一般物件與陣列(JSON可表達之資料)之可列舉資料屬性, 以屬性描述子讀值而不呼叫getter; 其餘型別(Date、函數等)不進入
    //以堆疊迭代避免本檢查爆呼叫堆疊(其後castIdFind、castIdCond之遞迴由maxDepth保護), seen避免循環結構無窮迭代(循環與共用子結構之深度與展開由其後之measureFind判定)
    try {
        let seen = new Set()
        let stack = [v, 1] //成對: 節點, 其層數
        let chars = 0 //strict: 走訪到之字串碼元總長(字串值與物件鍵, 含重複出現者), 供品牌網之預算判斷
        let nodes = [] //strict: 走訪到之物件節點(純物件), 供逾預算時逐一探針
        while (stack.length > 0) {
            let depth = stack.pop()
            let o = stack.pop()
            if (seen.has(o)) {
                continue
            }
            let kind
            if (strict) {
                //Proxy(含原型鏈上者)、標籤與內建品牌物件須先於任何會執行使用端程式之判定(isobj讀標籤、in運算子、讀屬性), 且以不觸發陷阱之方式判斷(isCleanChain、isBrandObj)
                if (typeof o === 'object' && o !== null) {
                    if (!isCleanChain(o) || isBrandObj(o)) {
                        return 'irregular'
                    }
                    if (types.isDate(o)) {
                        //Date為葉(原值交後端, 後端只讀其時間槽), 但須乾淨: 附加之自有屬性(含__proto__鍵、getter)會被前後處理函數與診斷輸出看到(外審第二輪 A-06)
                        if (Reflect.ownKeys(o).length > 0) {
                            return 'irregular'
                        }
                        continue
                    }
                }
                kind = getKindFind(o)
            }
            else {
                kind = Array.isArray(o) ? 'arr' : (isobj(o) ? 'obj' : null) //寫入列維持原判準; 不用isarr: 其以Object.prototype.toString判定, 可被Symbol.toStringTag宣稱而走訪其length getter
            }
            if (kind === null) {
                continue
            }
            let arr = kind === 'arr'
            if (depth > maxDepth) {
                return 'deep'
            }
            seen.add(o)
            if (Object.prototype.hasOwnProperty.call(o, '__proto__')) {
                return 'proto'
            }
            let ks = arr ? null : Object.keys(o)
            if (strict && !arr) {
                if (!isPlainObj(o)) {
                    return 'irregular'
                }
                if (Reflect.ownKeys(o).length !== ks.length) {
                    return 'hidden'
                }
                nodes.push(o)
            }
            let n = arr ? o.length : ks.length
            for (let i = 0; i < n; i++) {
                let d = Object.getOwnPropertyDescriptor(o, arr ? i : ks[i])
                if (d === undefined) {
                    //空洞: find的map以array[index]讀到原型上之繼承值而成為密陣列; 寫入列逐索引迴圈對稀疏巨陣列(如new Array(2**32-1))近乎不終止, 其後的複製又把空洞展成密陣列
                    return strict ? 'irregular' : 'sparse'
                }
                if (isAcc(d)) {
                    return 'accessor'
                }
                if (strict && arr && !d.enumerable) {
                    return 'irregular'
                }
                if (strict) {
                    chars += arr ? 0 : ks[i].length
                    if (typeof d.value === 'string') {
                        chars += d.value.length
                    }
                }
                if (typeof d.value === 'object' && d.value !== null) {
                    stack.push(d.value, depth + 1)
                }
            }
            if (strict && arr && Reflect.ownKeys(o).length !== n + 1) {
                return 'irregular' //除索引與length外另有自有鍵
            }
        }
        //品牌物件與不可複製者之通用網, 於走訪全數通過(已無存取器)之後: 字串碼元總長在預算內且有structuredClone時以一次結構化複製證明,
        //否則(逾預算或無structuredClone)對走訪到之物件節點逐一以精確探針判斷util.types無對應判定之WeakRef與FinalizationRegistry(規則6 ⑥)
        if (strict && typeof v === 'object' && v !== null) {
            //最長路徑深度與展開後容器數(共用子結構、循環), 於結構化複製之前: 走訪全數通過故已無存取器與Proxy
            let rm = measureFind(v, maxDepth, MAX_NODES_FIND)
            if (rm !== null) {
                return rm
            }
            if (chars <= MAX_CHARS_CLONE && typeof structuredClone === 'function') {
                if (hasIrregularClone(v)) {
                    return 'irregular'
                }
            }
            else {
                for (let i = 0; i < nodes.length; i++) {
                    if (hasWeakSlot(nodes[i])) {
                        return 'irregular'
                    }
                }
            }
        }
        return null
    }
    catch (e) {
        return 'unreadable'
    }
}


function getErrFind(mode, find) {
    //select、delAll之find檢查(R-INPUT-01 規則3、R-OBJ-01 規則3), 通過回傳null, 否則回傳reject之字串
    //find給予(非undefined)須為純物件: 未給、undefined與空物件{}為無條件(select回全部、delAll刪全部), 舊版(未實作系列條件白名單)後端對非物件之find多視為無條件而回全表或刪全表, 且本套件之複本會洗掉類別實例等之條件, 故由本套件先擋
    //任何深度不得含自有__proto__鍵(複製時該鍵會被丟棄, 令ORM所見之條件與呼叫端含授權函數所見者不同)與存取器屬性(見getReasonBadKey), 且巢狀深度不得超過MAX_DEPTH_FIND
    //並以strict檢查複本會洗掉之結構(Symbol鍵、不可列舉鍵、巢狀非純物件、不規則陣列; R-OBJ-01 規則6), 不論資料表型態
    try {
        if (find !== undefined && typeof find === 'object' && find !== null && types.isProxy(find)) {
            return `invalid find of ${mode}, ${MSGS_BAD_KEY.irregular}` //Proxy(含已撤銷者)於任何位置皆reject, 不觸發任何陷阱(R-OBJ-01 規則6)
        }
        if (find !== undefined && !isPlainObj(find)) {
            return `invalid find of ${mode}, need an object`
        }
        let reason = getReasonBadKey(find, MAX_DEPTH_FIND, true)
        if (reason !== null) {
            return `invalid find of ${mode}, ${MSGS_BAD_KEY[reason]}`
        }
        return null
    }
    catch (e) {
        //isobj、取原型時拋錯, 如已撤銷之Proxy
        return `invalid find of ${mode}, ${MSGS_BAD_KEY.unreadable}`
    }
}


function isIrregularRow(v) {
    //寫入列是否為不乾淨之物件: Proxy、原型鏈上有Symbol.toStringTag、內建品牌物件(原型改為null之Map等無標籤可辨, 會被mapOwn洗成{}而寫入垃圾列)
    //全程不執行使用端程式(同find之分類); 類別實例與Object.create(proto)之列仍照常(mapOwn只複製自有可列舉鍵, 與後端一致), 此為與find之strict判準的差異
    //函數(含callable Proxy)亦判之: 宣稱Symbol.toStringTag為Object之函數可通過isobj而被當成列(外審 sol F02); 無標籤之普通函數仍由isobj判為非物件(not an object)
    if (typeof v === 'function') {
        return !isCleanChain(v)
    }
    return typeof v === 'object' && v !== null && (!isCleanChain(v) || isBrandObj(v))
}


function getItemsIrregularId(data) {
    //mix之del列: 後端讀id之方式不一(lodash cloneDeep保留原型而可讀到繼承之id並執行getter, 不可列舉之id有的後端讀得到), 本套件之跨段同鍵比對(R-MIX-01)只認自有可列舉之資料屬性,
    //id為存取器、繼承而來、不可列舉、或列為Proxy/帶標籤者, 後端與本套件所見之id可不同, 令同鍵防線失效(新增後即被刪除), 故整批拒絕; 回傳[{k}]
    let rs = []
    each(data, (v, k) => {
        if ((typeof v !== 'object' || v === null) && typeof v !== 'function') {
            return
        }
        if (!isCleanChain(v)) {
            rs.push({ k }) //含Proxy(isCleanChain已含自身之判斷)與callable Proxy、宣稱標籤之函數(外審 sol F02)
            return
        }
        if (typeof v === 'function') {
            return //普通函數: 後端無id可讀, 同單獨del交後端逐筆處置
        }
        for (let x = v; x !== null; x = Object.getPrototypeOf(x)) {
            let d = Object.getOwnPropertyDescriptor(x, 'id')
            if (d !== undefined) {
                if (x !== v || isAcc(d) || !d.enumerable) {
                    rs.push({ k })
                }
                return
            }
        }
    })
    return rs
}


function getErrBatch(msg, data) {
    //批次容器(insert、save、del之輸入陣列, mix之add、del、diff)須為乾淨之真密陣列, 通過回傳null, 否則回傳reject之字串
    //Proxy與原型鏈上有標籤者: 讀length與索引會執行使用端程式; 空洞: 迴圈與lodash each、map依length逐索引, 稀疏巨陣列(如new Array(2**32-1))近乎不終止並配置同數量之物件,
    //且空洞索引在原型上有資料時, 後續各步驟(each、map以array[index])讀到未經檢查之繼承列
    //單一物件輸入(非陣列)不在此列, 由列檢查處理
    let arr
    try {
        arr = Array.isArray(data)
    }
    catch (e) {
        return `${msg}, ${MSGS_BAD_KEY.irregular}` //已撤銷之Proxy: 無法分類為陣列或單一列, 於任何讀取與ORM呼叫之前固定拒收(外審 sol F06)
    }
    if (!arr) {
        return null
    }
    if (!isCleanChain(data)) {
        return `${msg}, ${MSGS_BAD_KEY.irregular}`
    }
    let bad = firstBadIndex(data)
    if (bad !== null) {
        return getMsgFail(`${msg}, ${MSGS_BAD_KEY[bad[1]]}`, [{ k: bad[0] }])
    }
    return null
}


function getMsgsBadKey(msg, data) {
    //寫入之各筆任何深度含不支援之鍵或屬性者(R-OBJ-01 規則3), 依原因分組回傳訊息陣列, 各組列其於輸入內之位置data[k]; 單一物件輸入視為第0筆
    //輸入為陣列時(批次容器)逐索引以屬性描述子取值: 索引為存取器即reject, 使其後各次讀取皆為資料屬性之讀取而與檢查之值一致
    let groups = new Map()
    let addFail = (reason, k) => {
        if (!groups.has(reason)) {
            groups.set(reason, [])
        }
        groups.get(reason).push({ k })
    }
    if (isArr(data)) {
        for (let k = 0; k < data.length; k++) {
            try {
                let d = Object.getOwnPropertyDescriptor(data, k)
                if (d === undefined) {
                    continue //空洞, 已由getErrBatch拒收(此處為縱深防禦, 不可達)
                }
                if (isAcc(d)) {
                    addFail('accessor', k) //索引存取器亦已由getErrBatch拒收(縱深防禦)
                    continue
                }
                let reason = isIrregularRow(d.value) ? 'irregular' : getReasonBadKey(d.value)
                if (reason !== null) {
                    addFail(reason, k)
                }
            }
            catch (e) { //Proxy陣列之陷阱拋錯
                addFail('unreadable', k)
            }
        }
    }
    else {
        let reason = isIrregularRow(data) ? 'irregular' : getReasonBadKey(data)
        if (reason !== null) {
            addFail(reason, 0)
        }
    }
    return map([...groups], ([reason, fails]) => getMsgFail(`${msg}, ${MSGS_BAD_KEY[reason]}`, fails))
}


function copyRowWithId(v, id) {
    //列之複本: 自有可列舉屬性(含Symbol鍵)以其描述子複製而不讀值(存取器原樣保留、不執行), 僅id換為id; 原物件展開 { ...v, id } 會執行可列舉Symbol鍵與其他可列舉getter(外審 sol F03)
    let r = {}
    for (let k of Reflect.ownKeys(v)) {
        let d = Object.getOwnPropertyDescriptor(v, k)
        if (d.enumerable) {
            Object.defineProperty(r, k, k === 'id' ? { value: id, writable: true, enumerable: true, configurable: true } : d)
        }
    }
    return r
}


function castIdRows(rows) {
    //寫入與刪除之數據: 各列之主鍵正規化, 寫於複本, 不改呼叫端之物件; 非物件之列原樣
    //主鍵只認自有可列舉之資料屬性(getRowId, R-OBJ-01 規則7 ①): 不可列舉、繼承、經存取器者視為未提供, 不轉型亦不執行getter
    let one = !isArr(rows)
    let rs = map(one ? [rows] : rows, (v) => {
        let id = getRowId(v) //只讀自有可列舉之資料屬性, 不執行getter, 與adjustData之mapOwn所見一致
        if (isIdNumFinite(id) && isobj(v)) {
            return copyRowWithId(v, castIdValue(id))
        }
        return v
    })
    return one ? rs[0] : rs
}


function castIdCond(c) {
    //主鍵之條件: 值或運算子物件; 只轉型系列白名單內比較運算子($eq、$ne、$gt、$gte、$lt、$lte、$in、$nin)之值(陣列逐一), 其餘運算子原樣
    //白名單外之運算子($not、$all、$nor、$regex、$exists等)由各w-orm後端整批reject, 本套件不轉型亦不攔截(R-WL-01)
    //容器之判定用getKindFind, 與getErrFind之檢查同一判準(R-OBJ-01 規則6); 非'obj'、'arr'者原值或原參考交後端
    if (getKindFind(c) !== 'obj') {
        return castIdValue(c)
    }
    return mapOwn(c, (v, k) => {
        if (['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin'].indexOf(k) >= 0) {
            return getKindFind(v) === 'arr' ? map(v, castIdValue) : castIdValue(v)
        }
        return v
    })
}


function castIdFind(find) {
    //查詢條件(select、delAll之find): id之條件轉型, 遞迴文件層$and、$or; 他欄原樣; 寫於複本, 非物件原樣
    //容器之判定用getKindFind, 與getErrFind之檢查同一判準(R-OBJ-01 規則6)
    if (getKindFind(find) !== 'obj') {
        return find
    }
    return mapOwn(find, (v, k) => {
        if (k === 'id') {
            return castIdCond(v)
        }
        if (['$and', '$or'].indexOf(k) >= 0 && getKindFind(v) === 'arr') {
            return map(v, castIdFind)
        }
        return v
    })
}


function getItemsNotObj(data) {
    //寫入之各筆須為一般物件(R-INPUT-01), 回傳[{k}], k為其於輸入內之位置; 單一非物件輸入視為第0筆
    //非物件之元素經adjustData之clearXSS逐鍵複製時, 字串、陣列被展開成{0:...,1:...}、數字等變成{}, 寫入垃圾紀錄
    let rs = []
    each(isArr(data) ? data : [data], (v, k) => {
        if (isIrregularRow(v)) {
            return //由getMsgsBadKey以irregular回報, 且不對其執行isobj(會讀Symbol.toStringTag而執行使用端程式)
        }
        if (!isobj(v)) {
            rs.push({ k })
        }
    })
    return rs
}


function getMixIdKey(v) {
    //mix跨段比對用之主鍵鍵值(R-MIX-01): 以castIdValue正規化(有限數字取其字串形式, 與寫入、刪除之轉型同一函數), 正規化後為非空字串者取之, 其餘(未提供)不參與比對
    //主鍵經getRowId只認自有可列舉之資料屬性, 即adjustData之mapOwn實際寫入者(原get(v, 'id')會讀到不可列舉、繼承、經存取器之id而誤拒, R-MIX-01 規則6)
    //不論資料表是否適用轉型(R-ID-02)皆正規化, 故整數主鍵欄之5與'5'亦視為同鍵
    let id = castIdValue(getRowId(v))
    return isestr(id) ? id : null
}


function getMsgsMixSameId(input) {
    //mix之add與del、del與diff含同一主鍵者回傳各組之訊息(R-MIX-01), 位置以段名[k]列出而不回顯主鍵
    //mix依add、del、diff之序執行, add與del同鍵將使新增因已存在而略過後即被刪除, del與diff同鍵將使刪除後由save以部份欄位重新插入
    let msgs = []
    for (let [ka, kb] of [['add', 'del'], ['del', 'diff']]) {

        //ma, 前段各主鍵之位置
        let ma = new Map()
        each(get(input, ka, []), (v, k) => {
            let key = getMixIdKey(v)
            if (key !== null) {
                ma.set(key, [...(ma.get(key) || []), k])
            }
        })

        //ia, ib, 同鍵者之位置
        let ia = []
        let ib = []
        each(get(input, kb, []), (v, k) => {
            let key = getMixIdKey(v)
            if (key !== null && ma.has(key)) {
                ia = [...ia, ...ma.get(key)]
                ib.push(k)
            }
        })

        //msgs
        if (size(ib) > 0) {
            let refs = [
                ...map([...new Set(ia)].sort((a, b) => a - b), (k) => ({ ref: `${ka}[${k}]` })),
                ...map(ib, (k) => ({ ref: `${kb}[${k}]` })),
            ]
            msgs.push(getMsgFail(`invalid input of mix, same id in ${ka} and ${kb}`, refs))
        }

    }
    return msgs
}


function getItemsIdXSS(data) {
    //輸入數據之主鍵(非空字串)會被clearXSS改寫者, 回傳[{k,id}], k為其於輸入內之位置; 主鍵經getRowId只認自有可列舉之資料屬性(不執行getter)
    //寫入路徑之欄位皆經clearXSS而select與del不經過, 主鍵被改寫後以原主鍵查詢與刪除皆找不到, 故呼叫端須於寫入前整批拒絕
    let rs = []
    each(isArr(data) ? data : [data], (v, k) => {
        let id = getRowId(v)
        if (isestr(id) && clearXSS(id) !== id) {
            rs.push({ k, id })
        }
    })
    return rs
}


function getMsgIdXSS(msg, fails) {
    //主鍵含HTML標記, 訊息只列位置不回顯主鍵, 主鍵原文只在診斷輸出之細節(logDetail或funLog, R-DIAG-01)
    return getMsgFail(`${msg}, id contains HTML markup`, map(fails, (v) => {
        return { k: v.k }
    }))
}


function setOwnData(o, k, v) {
    //以defineProperty寫入自有可列舉之資料屬性, 不用賦值: 賦值會執行原型上之setter(類別DTO以setter攔截稽核欄位時, 其副作用可在跨段同鍵檢查之後改寫id, 外審 sol F04);
    //結果與無setter時之賦值相同(呼叫端物件多一個自有欄位, 既有行為見R-OBJ-01 已知限制), 凍結物件仍拋TypeError而由adjustData之呼叫端轉為failed to adjust data
    Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true })
}


function adjustData(ds, woName, userId, data, mode = 'save', keepUserId = false, diag = undefined) { //mode: 'insert', 'save', 'insert+save'; keepUserId只由insert傳true(R-KEEPUSER-01); diag為診斷輸出(R-DIAG-01)

    //check
    if (!iseobj(ds)) {
        diag('ds', getBriefType(ds), () => ds)
        throw new Error('invalid ds')
    }

    //keys
    let keys = ds[woName].keys

    //one
    let one = false
    if (!isarr(data)) {
        one = true
        data = [data]
    }

    //t
    let t = nowms2str()

    //userId, timeCreate
    if (mode.indexOf('insert') >= 0) {

        //userId, keepUserId者(opt.keepUserId, 列上userId為擁有者而非建立者)逐列保留自有非空字串之userId, 其餘以操作者補; userIdUpdate不受影響, 恆為操作者
        if (keys.indexOf('userId') >= 0) {
            each(data, (v, k) => {
                if (keepUserId && hasOwnerUserId(data[k])) {
                    return
                }
                setOwnData(data[k], 'userId', userId)
            })
        }

        //timeCreate
        if (keys.indexOf('timeCreate') >= 0) {

            each(data, (v, k) => {
                setOwnData(data[k], 'timeCreate', t)
            })
        }

        //userIdUpdate
        if (keys.indexOf('userIdUpdate') >= 0) {
            each(data, (v, k) => {
                setOwnData(data[k], 'userIdUpdate', userId)
            })
        }

        //timeUpdate
        if (keys.indexOf('timeUpdate') >= 0) {
            each(data, (v, k) => {
                setOwnData(data[k], 'timeUpdate', t)
            })
        }

    }

    //userIdUpdate, timeUpdate, 不能用else否則無法同時處理
    if (mode.indexOf('insert') >= 0 || mode.indexOf('save') >= 0) {

        //userIdUpdate
        if (keys.indexOf('userIdUpdate') >= 0) {
            each(data, (v, k) => {
                setOwnData(data[k], 'userIdUpdate', userId)
            })
        }

        //timeUpdate
        if (keys.indexOf('timeUpdate') >= 0) {
            each(data, (v, k) => {
                setOwnData(data[k], 'timeUpdate', t)
            })
        }

    }

    //clearXSS
    if (true) {
        data = map(data, (v) => {
            return mapOwn(v, (vv) => {
                return clearXSS(vv)
            })
        })
    }

    //id, 未提供有效主鍵者由本套件補值, 令回傳之主鍵與實際寫入者一致, 補值器同各ORM之genIDSeq(R-ID-01)
    //有效主鍵為非空字串: 字串型主鍵欄之有限數字已於mapOrm轉為字串(R-ID-02), 剩餘之數字(NaN、±Infinity)與其他型別視為未提供
    //補值寫在上方之複本, 不改呼叫端原物件
    //輸入依wsemi之iseobj、isearr判為無效者(單一空物件、只含一個空物件之陣列)不補, 保留ORM視之為無效輸入(規格T5)而不寫入之行為;
    //多筆批次中之空物件列則補, 因後端照常補值寫入, 不補則回傳undefined而與實際不符
    if (isPkIdString(ds[woName], keys)) {
        let effective = one ? iseobj(data[0]) : isearr(data)
        if (effective) {
            each(data, (v) => {
                if (!isestr(v.id)) {
                    v.id = genIDSeq()
                }
            })
        }
    }

    //復原data型態, 若原本data為物件則取第0個回傳
    data = one ? data[0] : data

    return data
}


async function mapOrm(ds, woItems, userId, woName, mode, input, opt, diag) {
    //邊界保證(R-ERR-01 規則5): execMapOrm之檢查、轉型與ORM呼叫階段, 非字串之例外(RangeError、使用端物件之Proxy陷阱/toString拋錯、woItems之非ORM值等)
    //一律診斷輸出(預設只列錯誤類別, 原文為細節)後以固定字串reject, 不轉出例外物件與其拋出之值; 字串(各處之固定訊息)原樣轉出
    try {
        return await execMapOrm(ds, woItems, userId, woName, mode, input, opt, diag)
    }
    catch (e) {
        if (typeof e === 'string') {
            return Promise.reject(e)
        }
        //標籤只放行已驗證之表名(woItems之自有鍵)與固定之mode, 其餘以空字串代替(此時外部傳入之字串尚未驗證, 不得回顯)
        let nameOk = false
        try {
            nameOk = typeof woName === 'string' && Object.prototype.hasOwnProperty.call(woItems, woName)
        }
        catch (e2) {
            //woItems為已撤銷之Proxy等: 不回顯
        }
        let modeOk = typeof mode === 'string' && MODES_PROC.indexOf(mode) >= 0
        diag(`${nameOk ? woName : ''}.${modeOk ? mode : ''} mapOrm catch`, getBriefErr(e), () => e)
        return Promise.reject('failed to process input')
    }
}


async function execMapOrm(ds, woItems, userId, woName, mode, input, opt, diag) {
    //診斷輸出(R-DIAG-01): 一律經diag(label, safe, getDetail), 預設只輸出標籤與不含主鍵、資料值、ORM錯誤原文之摘要; 完整細節由logDetail或funLog取得
    //由woName自動綁定至woItems內的ORM物件
    let err = null
    let r

    //check
    if (!iseobj(woItems)) {
        return Promise.reject(`invalid woItems`)
    }

    //wo, woName須為woItems之自有字串屬性(R-INPUT-01 規則5)
    let wo = getOwnItem(woItems, woName)

    //check, 訊息回顯字串之woName為既有慣例(R-MSG-01 其他已知限制), 非字串者不回顯
    if (wo === null) {
        return Promise.reject(`can not find table[${typeof woName === 'string' ? woName : ''}] in ORM`)
    }

    //idCast, 主鍵之有限數字以其字串形式處置(R-ID-02), 寫入、刪除與查詢條件共用同一判定
    let idCast = isIdCast(ds, woName)

    //optProc, 第5參數opt(只改不增、刪除回報未命中, R-ONLYMOD-01), 於任何讀寫之前檢查
    let optProc = getOptProc(mode, opt)
    if (optProc.err !== null) {
        return Promise.reject(optProc.err)
    }

    if (mode === 'select') {

        //check, 條件若給予須為一般物件且不含自有__proto__鍵(R-INPUT-01 規則3、R-OBJ-01 規則3), 於轉型與查詢之前
        let errFind = getErrFind('select', input)
        if (errFind !== null) {
            logFind(diag, `${woName}.select invalid find`, errFind, input)
            return Promise.reject(errFind)
        }

        //select, 條件中主鍵之比較值轉型(R-ID-02)
        r = await wo.select(idCast ? castIdFind(input) : input)
            .catch((msg) => {
                diag(`${woName}.select catch`, getBriefErr(msg), () => msg)
                err = 'failed to select data'
            })

        //check
        if (isestr(err)) {
            return Promise.reject(err)
        }

    }
    else if (mode === 'insert' || mode === 'save') {

        //inputOrig, 呼叫端原輸入, 逐筆失敗之訊息以呼叫端視角列出(本套件補出之主鍵只寫於複本, reject時呼叫端未曾取得)
        let inputOrig = input

        //msgMode
        let msgMode = mode === 'insert' ? 'failed to insert data' : 'failed to save data'

        //check, 批次容器須為乾淨之真密陣列(Proxy、標籤、空洞), 於讀取任何元素之前
        let errBatch = getErrBatch(msgMode, input)
        if (errBatch !== null) {
            diag(`${woName}.${mode} invalid batch container`)
            return Promise.reject(errBatch)
        }

        //check, 各筆須為一般物件, 否則整批拒絕且不寫入任何一筆(R-INPUT-01)
        let failsNotObj = getItemsNotObj(input)
        if (size(failsNotObj) > 0) {
            diag(`${woName}.${mode} data is not an object`, getBriefFails(failsNotObj), () => cpDetail(failsNotObj))
            return Promise.reject(getMsgFail(`${msgMode}, not an object`, failsNotObj))
        }

        //check, 各筆任何深度不得含自有__proto__鍵與存取器屬性, 否則整批拒絕且不寫入任何一筆(R-OBJ-01 規則3)
        let msgsBadKey = getMsgsBadKey(msgMode, input)
        if (size(msgsBadKey) > 0) {
            diag(`${woName}.${mode} data has unsupported key`, [...msgsBadKey], () => [...msgsBadKey]) //訊息為固定句型加位置, 不含主鍵與資料值; 交出拷貝
            return Promise.reject(join(msgsBadKey, '; '))
        }

        //castIdRows, 主鍵之有限數字轉為字串, 寫於複本(R-ID-02)
        if (idCast) {
            input = castIdRows(input)
        }

        //check, 主鍵會被clearXSS改寫者整批拒絕, 不寫入任何一筆
        let failsIdXSS = getItemsIdXSS(input)
        if (size(failsIdXSS) > 0) {
            diag(`${woName}.${mode} id changed by clearXSS`, getBriefFails(failsIdXSS), () => cpDetail(failsIdXSS))
            return Promise.reject(getMsgIdXSS(msgMode, failsIdXSS))
        }

        //adjustData
        try {
            input = adjustData(ds, woName, userId, input, mode, optProc.keepUserId, diag)
        }
        catch (e) {
            let msgE = e.toString() //同舊版立即求值: 例外之toString拋錯(如拋出null)者交邊界保證轉為failed to process input, 診斷輸出不改變此結果
            diag(`${woName}.adjustData catch`, getBriefErr(e), () => msgE)
            err = 'failed to adjust data'
            return Promise.reject(err)
        }

        //exist, 只改不增(opt.mustExist, R-ONLYMOD-01): 寫入之前檢查全部列(含補主鍵後)皆已存在, 任一列不存在(含無主鍵之列)即整批reject 'rowNotFound'而不寫入任何一筆
        //檢查與寫入非原子, 呼叫端須已持有該表之表鎖(withTabLocks、guardWrite)
        if (mode === 'save' && optProc.mustExist) {
            let missing = await hasMissingRow(wo, input)
                .catch((msg) => {
                    diag(`${woName}.save exist check catch`, getBriefErr(msg), () => msg)
                    err = 'failed to save data'
                })
            if (isestr(err)) {
                return Promise.reject(err)
            }
            if (missing) {
                diag(`${woName}.save row not found`)
                return Promise.reject('rowNotFound')
            }
        }

        //save
        if (mode === 'insert') {
            r = await wo.insert(input)
                .catch((msg) => {
                    diag(`${woName}.insert catch`, getBriefErr(msg), () => msg)
                    err = 'failed to insert data'
                })
        }
        else if (mode === 'save') {
            //只改不增者轉傳autoInsert:false(各ORM於未命中時不寫入); 其餘維持單參數呼叫
            r = await (optProc.mustExist ? wo.save(input, { autoInsert: false }) : wo.save(input))
                .catch((msg) => {
                    diag(`${woName}.save catch`, getBriefErr(msg), () => msg)
                    err = 'failed to save data'
                })
        }

        //check
        if (isestr(err)) {
            return Promise.reject(err)
        }

        //check, insert之錯誤皆屬整批性而reject, 其回傳為聚合物件且ok恆為1; 聚合結果ok為0或逐筆陣列任一筆ok為0者(ORM違約, 見isOrmFail)視為失敗, 不可回成功, 以固定字串整批reject
        if (mode === 'insert' && isOrmFail(r)) {
            diag(`${woName}.insert fail`, getBriefResult(r), () => r)
            return Promise.reject('failed to insert data')
        }

        //check, save單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
        if (mode === 'save') {
            let fails = getItemsFail(r, input)
            if (size(fails) > 0) {
                diag(`${woName}.save fail`, getBriefFails(fails), () => cpDetail(fails))
                return Promise.reject(getMsgFail('failed to save data', getItemsFail(r, inputOrig)))
            }

            //check, 回傳聚合物件而ok為0(非契約形狀)者無從逐筆列出, 仍視為失敗, 固定字串reject(R-ORM-RESULT-01); 陣列形之失敗已於上方列出
            if (isOrmFail(r)) {
                diag(`${woName}.save fail`, getBriefResult(r), () => r)
                return Promise.reject('failed to save data')
            }

            //check, 只改不增者之事後偵測: 逐筆n為0表檢查後、寫入前該列被他方刪除(表鎖紀律被破壞), 已寫入之筆無從回復, 仍回報rowNotFound
            if (optProc.mustExist && hasNoHit(r, null)) {
                diag(`${woName}.save row not found after check`)
                return Promise.reject('rowNotFound')
            }
        }

        //僅回傳id避免大量數據時造成負擔
        if (isarr(input)) {
            r = map(input, (v) => {
                return { id: v.id }
            })
        }
        else {
            r = { id: input.id }
        }
        //console.log(mode, ' r', r)

    }
    else if (mode === 'del') {

        //check, 批次容器須為乾淨之真密陣列; 刪除之各筆仍不檢查(交後端逐筆處置)
        let errBatch = getErrBatch('failed to delete data', input)
        if (errBatch !== null) {
            diag(`${woName}.del invalid batch container`)
            return Promise.reject(errBatch)
        }

        //castIdRows, 主鍵之有限數字轉為字串, 寫於複本(R-ID-02); 刪除不經clearXSS(R-XSS-01)
        if (idCast) {
            input = castIdRows(input)
        }

        //exist, 刪除回報未命中(opt.mustExist, R-ONLYMOD-01): 刪除之前檢查全部列皆存在, 任一列不存在(含無主鍵之列)即整批reject 'rowNotFound'而不刪除任何一筆
        //檢查與刪除非原子, 呼叫端須已持有該表之表鎖(withTabLocks、guardWrite)
        if (optProc.mustExist) {

            //check, 同批重複主鍵整批拒絕, 訊息列其位置而不回顯主鍵(同R-MIX-01)
            let failsDup = getItemsDupId(input)
            if (size(failsDup) > 0) {
                diag(`${woName}.del duplicate id`, getBriefFails(failsDup), () => cpDetail(failsDup))
                return Promise.reject(getMsgFail('invalid input of del, duplicate id', failsDup))
            }

            let missing = await hasMissingRow(wo, input)
                .catch((msg) => {
                    diag(`${woName}.del exist check catch`, getBriefErr(msg), () => msg)
                    err = 'failed to delete data'
                })
            if (isestr(err)) {
                return Promise.reject(err)
            }
            if (missing) {
                diag(`${woName}.del row not found`)
                return Promise.reject('rowNotFound')
            }
        }

        //del
        r = await wo.del(input)
            .catch((msg) => {
                diag(`${woName}.del catch`, getBriefErr(msg), () => msg)
                err = 'failed to delete data'
            })

        //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
        if (!isestr(err)) {
            let fails = getItemsFail(r, input)
            if (size(fails) > 0) {
                diag(`${woName}.del fail`, getBriefFails(fails), () => cpDetail(fails))
                err = getMsgFail('failed to delete data', fails)
            }
            else if (isOrmFail(r)) {
                //回傳聚合物件而ok為0(非契約形狀)者無從逐筆列出, 仍視為失敗, 固定字串(R-ORM-RESULT-01)
                diag(`${woName}.del fail`, getBriefResult(r), () => r)
                err = 'failed to delete data'
            }
        }

        //check, 刪除回報未命中者之事後偵測: 逐筆nDeleted或n為0表檢查後、刪除前該列被他方刪除(表鎖紀律被破壞), 已刪除之筆無從回復, 仍回報rowNotFound
        if (!isestr(err) && optProc.mustExist && hasNoHit(r, 'nDeleted')) {
            diag(`${woName}.del row not found after check`)
            err = 'rowNotFound'
        }

    }
    else if (mode === 'delAll') {

        //check, 條件若給予須為一般物件(R-INPUT-01 規則3): 舊版(未實作系列條件白名單)後端對非物件之條件一律視為無條件而刪除全表; 未給(undefined)與空物件依規格為刪除全部; 另不得含自有__proto__鍵(R-OBJ-01 規則3)
        let errFind = getErrFind('delAll', input)
        if (errFind !== null) {
            logFind(diag, `${woName}.delAll invalid find`, errFind, input)
            return Promise.reject(errFind)
        }

        //delAll, 條件中主鍵之比較值轉型(R-ID-02)
        r = await wo.delAll(idCast ? castIdFind(input) : input)
            .catch((msg) => {
                diag(`${woName}.delAll catch`, getBriefErr(msg), () => msg)
                err = 'failed to delete data'
            })

        //check, delAll契約為聚合物件且ok恆為1(錯誤皆整批reject); ok為0或逐筆陣列任一筆ok為0者(ORM違約, 見isOrmFail)視為失敗, 不可回成功(R-ORM-RESULT-01)
        if (!isestr(err) && isOrmFail(r)) {
            diag(`${woName}.delAll fail`, getBriefResult(r), () => r)
            err = 'failed to delete data'
        }

    }
    else if (mode === 'mix') {

        //check, input須為乾淨之一般物件: Proxy(含已撤銷者)、原型鏈有標籤者於讀取任何屬性之前拒收(iseobj讀標籤、input.add讀屬性皆會執行使用端程式, 外審 minimax F3)
        if (typeof input !== 'object' || input === null || !isCleanChain(input) || !iseobj(input)) {
            return Promise.reject('invalid input of mix, need the result object of ltdtDiffByKey')
        }

        //check, add、del、diff為存取器者整批拒絕(R-OBJ-01 規則3 批次容器), 並取自有資料屬性之快照(各讀一次, 其後只用快照; 繼承而來者不取), 使各檢查與寫入所見一致
        let snap = {}
        for (let key of ['add', 'del', 'diff']) {
            let d = Object.getOwnPropertyDescriptor(input, key)
            if (d !== undefined && isAcc(d)) {
                return Promise.reject(`invalid input of mix, ${MSGS_BAD_KEY.accessor}`)
            }
            snap[key] = d === undefined ? undefined : d.value
        }
        input = snap

        //check, add、del、diff若給予須為陣列(R-INPUT-01), 否則各段之回傳將逐欄位產生
        for (let key of ['add', 'del', 'diff']) {
            if (input[key] !== undefined && !isArr(input[key])) {
                return Promise.reject('invalid input of mix, need the result object of ltdtDiffByKey')
            }
        }

        //check, add、del、diff須為乾淨之真密陣列(Proxy、標籤、空洞), 於讀取任何元素之前
        let msgsBatch = []
        for (let [key, msg] of [['add', 'failed to insert data'], ['del', 'failed to delete data'], ['diff', 'failed to update data']]) {
            let errBatch = getErrBatch(msg, input[key])
            if (errBatch !== null) {
                msgsBatch.push(errBatch)
            }
        }
        if (size(msgsBatch) > 0) {
            diag(`${woName}.mix invalid batch container`)
            return Promise.reject(join(msgsBatch, '; '))
        }

        //check, 新增與修改之各筆須為一般物件, 於任何步驟寫入之前整批拒絕(R-INPUT-01)
        let msgsNotObj = []
        for (let [key, msg] of [['add', 'failed to insert data'], ['diff', 'failed to update data']]) {
            let fails = getItemsNotObj(get(input, key, []))
            if (size(fails) > 0) {
                diag(`${woName}.mix ${key} data is not an object`, getBriefFails(fails), () => cpDetail(fails))
                msgsNotObj.push(getMsgFail(`${msg}, not an object`, fails))
            }
        }
        if (size(msgsNotObj) > 0) {
            return Promise.reject(join(msgsNotObj, '; '))
        }

        //check, 新增與修改之各筆任何深度不得含自有__proto__鍵與存取器屬性, 於任何步驟寫入之前整批拒絕(R-OBJ-01 規則3); del之各筆不檢查(R-OBJ-01 已知限制)
        let msgsBadKey = []
        for (let [key, msg] of [['add', 'failed to insert data'], ['diff', 'failed to update data']]) {
            msgsBadKey.push(...getMsgsBadKey(msg, get(input, key, [])))
        }
        if (size(msgsBadKey) > 0) {
            diag(`${woName}.mix data has unsupported key`, [...msgsBadKey], () => [...msgsBadKey]) //訊息為固定句型加位置, 不含主鍵與資料值; 交出拷貝
            return Promise.reject(join(msgsBadKey, '; '))
        }

        //check, del列之id不得為存取器或繼承而來(同鍵防線之前提), 於任何步驟寫入之前整批拒絕
        let failsIrregularId = getItemsIrregularId(get(input, 'del', []))
        if (size(failsIrregularId) > 0) {
            diag(`${woName}.mix del id is not an own data property`, getBriefFails(failsIrregularId), () => cpDetail(failsIrregularId))
            return Promise.reject(getMsgFail(`failed to delete data, ${MSGS_BAD_KEY.irregular}`, failsIrregularId))
        }

        //castIdRows, 各段主鍵之有限數字轉為字串, 寫於複本(R-ID-02)
        if (idCast) {
            input = { ...input }
            for (let key of ['add', 'del', 'diff']) {
                if (isarr(input[key])) {
                    input[key] = castIdRows(input[key])
                }
            }
        }

        //check, 新增與修改之主鍵會被clearXSS改寫者, 於任何步驟寫入之前整批拒絕
        let msgsIdXSS = []
        for (let [key, msg] of [['add', 'failed to insert data'], ['diff', 'failed to update data']]) {
            let fails = getItemsIdXSS(get(input, key, []))
            if (size(fails) > 0) {
                diag(`${woName}.mix ${key} id changed by clearXSS`, getBriefFails(fails), () => cpDetail(fails))
                msgsIdXSS.push(getMsgIdXSS(msg, fails))
            }
        }
        if (size(msgsIdXSS) > 0) {
            return Promise.reject(join(msgsIdXSS, '; '))
        }

        //check, add與del、del與diff同鍵者, 於任何步驟寫入之前整批拒絕(R-MIX-01)
        let msgsSameId = getMsgsMixSameId(input)
        if (size(msgsSameId) > 0) {
            diag(`${woName}.mix same id across steps`, [...msgsSameId], () => [...msgsSameId]) //訊息只列各段位置, 不含主鍵; 交出拷貝
            return Promise.reject(join(msgsSameId, '; '))
        }

        //rt,r
        let rt
        r = [] //default to array

        //msgsFail, 逐筆失敗僅影響該筆, 不中斷後續步驟, 待全部步驟完成後一併reject; 整批性錯誤則仍立即reject
        let msgsFail = []

        //diff之adjustData提前於任何ORM呼叫之前(取得清除後之深複本): 後端於del步驟會讀取del列(可能執行其上之使用端程式), 其副作用不得改動尚未寫入之diff(外審 sol F03)
        //add之adjustData原即於第一個ORM呼叫之前; 整批性之adjust失敗亦因而不致發生於add、del已寫入之後
        let diffAdj = null
        if (size(get(input, 'diff', [])) > 0) {
            try {
                diffAdj = adjustData(ds, woName, userId, get(input, 'diff', []), 'save', false, diag)
            }
            catch (e) {
                let msgE = e.toString() //同上, 立即求值
                diag(`${woName}.adjustData catch`, getBriefErr(e), () => msgE)
                err = 'failed to adjust data'
                return Promise.reject(err)
            }
        }

        let add = get(input, 'add', [])
        if (size(add) > 0) {

            //adjustData
            try {
                add = adjustData(ds, woName, userId, add, 'insert+save', false, diag)
            }
            catch (e) {
                let msgE = e.toString() //同上, 立即求值
                diag(`${woName}.adjustData catch`, getBriefErr(e), () => msgE)
                err = 'failed to adjust data'
                return Promise.reject(err)
            }

            //insert
            let rsAdd = await wo.insert(add)
                .catch((msg) => {
                    diag(`${woName}.insert catch`, getBriefErr(msg), () => msg)
                    err = 'failed to insert data'
                })

            //check
            if (isestr(err)) {
                return Promise.reject(err)
            }

            //check, 同單獨insert, 回報失敗者(isOrmFail)視為整批性失敗, 立即reject, 後續步驟不執行
            if (isOrmFail(rsAdd)) {
                diag(`${woName}.insert fail`, getBriefResult(rsAdd), () => rsAdd)
                return Promise.reject('failed to insert data')
            }

            //r
            rt = map(add, (v) => {
                return { id: v.id } //僅回傳id避免大量數據時造成負擔
            })
            r = [...r, ...rt]
        }

        let del = get(input, 'del', [])
        if (size(del) > 0) {

            //del
            let rs = await wo.del(del)
                .catch((msg) => {
                    diag(`${woName}.del catch`, getBriefErr(msg), () => msg)
                    err = 'failed to delete data'
                })

            //check
            if (isestr(err)) {
                return Promise.reject(err)
            }

            //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
            let fails = getItemsFail(rs, del)
            if (size(fails) > 0) {
                diag(`${woName}.del fail`, getBriefFails(fails), () => cpDetail(fails))
                msgsFail.push(getMsgFail('failed to delete data', fails))
            }
            else if (isOrmFail(rs)) {
                //回傳聚合物件而ok為0(非契約形狀)者無從逐筆列出, 視為該步驟整批性失敗, 立即reject, 後續步驟不執行(R-ORM-RESULT-01)
                diag(`${woName}.del fail`, getBriefResult(rs), () => rs)
                return Promise.reject('failed to delete data')
            }

            //r
            rt = map(del, (v) => {
                return { id: v.id } //僅回傳id避免大量數據時造成負擔
            })
            r = [...r, ...rt]
        }

        let diff = get(input, 'diff', [])
        if (size(diff) > 0) {

            //diffOrig, 呼叫端原輸入, 逐筆失敗之訊息以呼叫端視角列出
            let diffOrig = diff

            //adjustData已於上方提前完成
            diff = diffAdj

            //save
            let rs = await wo.save(diff)
                .catch((msg) => {
                    diag(`${woName}.save catch`, getBriefErr(msg), () => msg)
                    err = 'failed to update data'
                })

            //check
            if (isestr(err)) {
                return Promise.reject(err)
            }

            //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
            let fails = getItemsFail(rs, diff)
            if (size(fails) > 0) {
                diag(`${woName}.save fail`, getBriefFails(fails), () => cpDetail(fails))
                msgsFail.push(getMsgFail('failed to update data', getItemsFail(rs, diffOrig)))
            }
            else if (isOrmFail(rs)) {
                //同上, 回傳聚合物件而ok為0(非契約形狀)者立即reject(R-ORM-RESULT-01)
                diag(`${woName}.save fail`, getBriefResult(rs), () => rs)
                return Promise.reject('failed to update data')
            }

            //r
            rt = map(diff, (v) => {
                return { id: v.id } //僅回傳id避免大量數據時造成負擔
            })
            r = [...r, ...rt]
        }

        //check, 各步驟之逐筆失敗於全部步驟完成後一併reject
        if (size(msgsFail) > 0) {
            return Promise.reject(join(msgsFail, '; '))
        }

        //console.log('mix r', r)
    }
    else {
        err = `invalid mode: ${mode}`
    }

    //check
    if (isestr(err)) {
        return Promise.reject(err)
    }

    return r
}


function getMapOrm(ds, woItems, optServ) {
    //每次呼叫各自綁定ds與woItems並回傳新函數, 令同一行程內之多個實例互不干擾; 回傳函數之參數形狀為(userId, woName, mode, input, opt), 前四個維持, opt為選用(R-ONLYMOD-01)
    //optServ(選用)為WServOrm之設定物件, 取其logDetail與funLog決定診斷輸出(R-DIAG-01), 未給為預設(安全摘要); 型別錯誤拋Error, 各實例各自持有
    let diag = getDiag(getOptLog(optServ))
    return async (userId, woName, mode, input, opt) => {
        return mapOrm(ds, woItems, userId, woName, mode, input, opt, diag)
    }
}


export { getOptProc }
export default getMapOrm
