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


function getMsgFail(msg, fails) {
    //前端訊息僅列出失敗筆, 錯誤原文另由console.log輸出, 與既有整批錯誤之處理一致
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


//不支援之鍵或屬性的原因與訊息(R-OBJ-01 規則3、5), 訊息只列固定字句, 不回顯客戶端之值
const MSGS_BAD_KEY = Object.freeze({
    proto: 'unsupported key[__proto__]',
    accessor: 'unsupported accessor property',
    unreadable: 'unreadable value',
    deep: 'too deep',
})

//find之巢狀深度上限, 以容器(一般物件與陣列)層數計, 根為第1層(R-OBJ-01 規則5)
//castIdFind、castIdCond以遞迴處理$and、$or、$nor與$not, 遞迴深度即呼叫堆疊深度, 實測字串型主鍵表約1173層$and(約2346個容器)起爆堆疊;
//64個容器層約為32層邏輯巢狀, 遠大於合理查詢(庫內最深約7個容器)而遠小於爆堆疊之閾值
const MAX_DEPTH_FIND = 64


function isPlainObj(v) {
    //純物件(R-INPUT-01 規則3): isobj為真且原型為null, 或為某realm之Object.prototype(同lodash isPlainObject: 原型之原型為null、有constructor函數、其函數原始碼同Object, 故跨realm之物件亦通過)
    //類別實例、Object.create(proto)、原型為null原型之一般物件、偽造Symbol.toStringTag之Map或包裝物件, 其自有可列舉鍵可能為空而被複製成{}, 令條件消失, 故不算
    if (!isobj(v)) {
        return false
    }
    let p = Object.getPrototypeOf(v)
    if (p === null) {
        return true
    }
    //p之原型為null, 故p.constructor只可能是p之自有屬性
    return Object.getPrototypeOf(p) === null &&
        typeof p.constructor === 'function' &&
        Function.prototype.toString.call(p.constructor) === Function.prototype.toString.call(Object)
}


function logSafe(label, ...args) {
    //診斷用之console.log: 輸出使用端原物件時會呼叫其util.inspect.custom, 拋錯不得使procOrm之reject變成例外物件(R-ERR-01 規則5)
    try {
        console.log(label, ...args)
    }
    catch (e) {
        try {
            console.log(label, '(unprintable)')
        }
        catch (e2) {
            //放棄輸出
        }
    }
}


function getReasonBadKey(v, maxDepth = Infinity) {
    //v之任何深度(一般物件之值、陣列之元素)含不支援之鍵或屬性者回傳原因(R-OBJ-01 規則3、5), 通過回傳null:
    //  proto: 含自有__proto__鍵, 不論可否列舉; 自有鍵可由JSON.parse、Object.fromEntries、展開、structuredClone等產生, 物件字面量之__proto__為設原型而不算
    //  accessor: 含存取器屬性(getter或setter), 其值每讀一次可能不同, 令檢查之值與使用之值無法保證相同, 且讀取可能有副作用
    //  unreadable: 檢查時拋錯, 如Proxy之陷阱或已撤銷之Proxy
    //  deep: 容器(一般物件與陣列)層數超過maxDepth(根為第1層), 走訪到第maxDepth+1層即停止; 只有find給予maxDepth, 寫入列不設上限(見R-OBJ-01 規則5)
    //只走一般物件與陣列(JSON可表達之資料)之可列舉資料屬性, 以屬性描述子讀值而不呼叫getter; 其餘型別(Date、Map、Set、函數等)不進入
    //以堆疊迭代避免本檢查爆呼叫堆疊(其後castIdFind、castIdCond之遞迴由maxDepth保護), seen避免循環結構無窮迭代(循環不會被判為過深, 見R-OBJ-01 已知限制)
    try {
        let seen = new Set()
        let stack = [v, 1] //成對: 節點, 其層數
        while (stack.length > 0) {
            let depth = stack.pop()
            let o = stack.pop()
            let arr = Array.isArray(o) //不用isarr: 其以Object.prototype.toString判定, 可被Symbol.toStringTag偽造而走訪其length getter; 偽造者isobj亦為假, 故不進入
            if (seen.has(o) || (!arr && !isobj(o))) {
                continue
            }
            if (depth > maxDepth) {
                return 'deep'
            }
            seen.add(o)
            if (Object.prototype.hasOwnProperty.call(o, '__proto__')) {
                return 'proto'
            }
            let ks = arr ? null : Object.keys(o)
            let n = arr ? o.length : ks.length
            for (let i = 0; i < n; i++) {
                let d = Object.getOwnPropertyDescriptor(o, arr ? i : ks[i])
                if (d === undefined) {
                    continue //稀疏陣列之空洞
                }
                if (d.get !== undefined || d.set !== undefined) {
                    return 'accessor'
                }
                if (typeof d.value === 'object' && d.value !== null) {
                    stack.push(d.value, depth + 1)
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
    //find給予(非undefined)須為純物件: 未給、undefined與空物件{}為無條件(select回全部、delAll刪全部), 各後端對非物件之find多視為無條件而回全表或刪全表, 故由本套件先擋
    //任何深度不得含自有__proto__鍵(複製時該鍵會被丟棄, 令ORM所見之條件與呼叫端含授權函數所見者不同)與存取器屬性(見getReasonBadKey), 且巢狀深度不得超過MAX_DEPTH_FIND
    try {
        if (find !== undefined && !isPlainObj(find)) {
            return `invalid find of ${mode}, need an object`
        }
        let reason = getReasonBadKey(find, MAX_DEPTH_FIND)
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
    if (Array.isArray(data)) {
        for (let k = 0; k < data.length; k++) {
            try {
                let d = Object.getOwnPropertyDescriptor(data, k)
                if (d === undefined) {
                    continue //空洞, 已於形狀檢查以非物件拒絕
                }
                if (d.get !== undefined || d.set !== undefined) {
                    addFail('accessor', k)
                    continue
                }
                let reason = getReasonBadKey(d.value)
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
        let reason = getReasonBadKey(data)
        if (reason !== null) {
            addFail(reason, 0)
        }
    }
    return map([...groups], ([reason, fails]) => getMsgFail(`${msg}, ${MSGS_BAD_KEY[reason]}`, fails))
}


function castIdRows(rows) {
    //寫入與刪除之數據: 各列之主鍵正規化, 寫於複本, 不改呼叫端之物件; 非物件之列原樣
    let one = !isarr(rows)
    let rs = map(one ? [rows] : rows, (v) => {
        if (isobj(v) && isIdNumFinite(v.id)) {
            return { ...v, id: castIdValue(v.id) }
        }
        return v
    })
    return one ? rs[0] : rs
}


function castIdCond(c) {
    //主鍵之條件: 值或運算子物件; 比較運算子之值(陣列逐一)轉型, $not遞迴, 其餘運算子($regex、$exists等)原樣
    if (!isobj(c)) {
        return castIdValue(c)
    }
    return mapOwn(c, (v, k) => {
        if (k === '$not') {
            return castIdCond(v)
        }
        if (['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$all'].indexOf(k) >= 0) {
            return isarr(v) ? map(v, castIdValue) : castIdValue(v)
        }
        return v
    })
}


function castIdFind(find) {
    //查詢條件(select、delAll之find): id之條件轉型, 遞迴$and、$or、$nor; 他欄原樣; 寫於複本, 非物件原樣
    if (!isobj(find)) {
        return find
    }
    return mapOwn(find, (v, k) => {
        if (k === 'id') {
            return castIdCond(v)
        }
        if (['$and', '$or', '$nor'].indexOf(k) >= 0 && isarr(v)) {
            return map(v, castIdFind)
        }
        return v
    })
}


function getItemsNotObj(data) {
    //寫入之各筆須為一般物件(R-INPUT-01), 回傳[{k}], k為其於輸入內之位置; 單一非物件輸入視為第0筆
    //非物件之元素經adjustData之clearXSS逐鍵複製時, 字串、陣列被展開成{0:...,1:...}、數字等變成{}, 寫入垃圾紀錄
    let rs = []
    each(isarr(data) ? data : [data], (v, k) => {
        if (!isobj(v)) {
            rs.push({ k })
        }
    })
    return rs
}


function getMixIdKey(v) {
    //mix跨段比對用之主鍵鍵值(R-MIX-01): 以castIdValue正規化(有限數字取其字串形式, 與寫入、刪除之轉型同一函數), 正規化後為非空字串者取之, 其餘(未提供)不參與比對
    //不論資料表是否適用轉型(R-ID-02)皆正規化, 故整數主鍵欄之5與'5'亦視為同鍵
    let id = castIdValue(get(v, 'id'))
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
    //輸入數據之主鍵(非空字串)會被clearXSS改寫者, 回傳[{k,id}], k為其於輸入內之位置
    //寫入路徑之欄位皆經clearXSS而select與del不經過, 主鍵被改寫後以原主鍵查詢與刪除皆找不到, 故呼叫端須於寫入前整批拒絕
    let rs = []
    each(isarr(data) ? data : [data], (v, k) => {
        let id = get(v, 'id')
        if (isestr(id) && clearXSS(id) !== id) {
            rs.push({ k, id })
        }
    })
    return rs
}


function getMsgIdXSS(msg, fails) {
    //主鍵含HTML標記, 訊息只列位置不回顯主鍵, 主鍵原文另由console.log輸出
    return getMsgFail(`${msg}, id contains HTML markup`, map(fails, (v) => {
        return { k: v.k }
    }))
}


function adjustData(ds, woName, userId, data, mode = 'save') { //mode: 'insert', 'save', 'insert+save'

    //check
    if (!iseobj(ds)) {
        console.log('ds', ds)
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

        //userId
        if (keys.indexOf('userId') >= 0) {
            each(data, (v, k) => {
                data[k].userId = userId
            })
        }

        //timeCreate
        if (keys.indexOf('timeCreate') >= 0) {

            each(data, (v, k) => {
                data[k].timeCreate = t
            })
        }

        //userIdUpdate
        if (keys.indexOf('userIdUpdate') >= 0) {
            each(data, (v, k) => {
                data[k].userIdUpdate = userId
            })
        }

        //timeUpdate
        if (keys.indexOf('timeUpdate') >= 0) {
            each(data, (v, k) => {
                data[k].timeUpdate = t
            })
        }

    }

    //userIdUpdate, timeUpdate, 不能用else否則無法同時處理
    if (mode.indexOf('insert') >= 0 || mode.indexOf('save') >= 0) {

        //userIdUpdate
        if (keys.indexOf('userIdUpdate') >= 0) {
            each(data, (v, k) => {
                data[k].userIdUpdate = userId
            })
        }

        //timeUpdate
        if (keys.indexOf('timeUpdate') >= 0) {
            each(data, (v, k) => {
                data[k].timeUpdate = t
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


async function mapOrm(ds, woItems, userId, woName, mode, input) {
    //邊界保證(R-ERR-01 規則5): execMapOrm之檢查、轉型與ORM呼叫階段, 非字串之例外(RangeError、使用端物件之Proxy陷阱/toString拋錯、woItems之非ORM值等)
    //一律console.log原文後以固定字串reject, 不轉出例外物件與其拋出之值; 字串(各處之固定訊息)原樣轉出
    try {
        return await execMapOrm(ds, woItems, userId, woName, mode, input)
    }
    catch (e) {
        if (typeof e === 'string') {
            return Promise.reject(e)
        }
        logSafe(`${typeof woName === 'string' ? woName : ''}.${typeof mode === 'string' ? mode : ''} mapOrm catch`, e)
        return Promise.reject('failed to process input')
    }
}


async function execMapOrm(ds, woItems, userId, woName, mode, input) {
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

    if (mode === 'select') {

        //check, 條件若給予須為一般物件且不含自有__proto__鍵(R-INPUT-01 規則3、R-OBJ-01 規則3), 於轉型與查詢之前
        let errFind = getErrFind('select', input)
        if (errFind !== null) {
            logSafe(`${woName}.select invalid find`, input)
            return Promise.reject(errFind)
        }

        //select, 條件中主鍵之比較值轉型(R-ID-02)
        r = await wo.select(idCast ? castIdFind(input) : input)
            .catch((msg) => {
                console.log(`${woName}.select catch`, msg)
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

        //check, 各筆須為一般物件, 否則整批拒絕且不寫入任何一筆(R-INPUT-01)
        let failsNotObj = getItemsNotObj(input)
        if (size(failsNotObj) > 0) {
            console.log(`${woName}.${mode} data is not an object`, failsNotObj)
            return Promise.reject(getMsgFail(`${msgMode}, not an object`, failsNotObj))
        }

        //check, 各筆任何深度不得含自有__proto__鍵與存取器屬性, 否則整批拒絕且不寫入任何一筆(R-OBJ-01 規則3)
        let msgsBadKey = getMsgsBadKey(msgMode, input)
        if (size(msgsBadKey) > 0) {
            console.log(`${woName}.${mode} data has unsupported key`, msgsBadKey)
            return Promise.reject(join(msgsBadKey, '; '))
        }

        //castIdRows, 主鍵之有限數字轉為字串, 寫於複本(R-ID-02)
        if (idCast) {
            input = castIdRows(input)
        }

        //check, 主鍵會被clearXSS改寫者整批拒絕, 不寫入任何一筆
        let failsIdXSS = getItemsIdXSS(input)
        if (size(failsIdXSS) > 0) {
            console.log(`${woName}.${mode} id changed by clearXSS`, failsIdXSS)
            return Promise.reject(getMsgIdXSS(msgMode, failsIdXSS))
        }

        //adjustData
        try {
            input = adjustData(ds, woName, userId, input, mode)
        }
        catch (e) {
            console.log(`${woName}.adjustData catch`, e.toString())
            err = 'failed to adjust data'
            return Promise.reject(err)
        }

        //save
        if (mode === 'insert') {
            r = await wo.insert(input)
                .catch((msg) => {
                    console.log(`${woName}.insert catch`, msg)
                    err = 'failed to insert data'
                })
        }
        else if (mode === 'save') {
            r = await wo.save(input)
                .catch((msg) => {
                    console.log(`${woName}.save catch`, msg)
                    err = 'failed to save data'
                })
        }

        //check
        if (isestr(err)) {
            return Promise.reject(err)
        }

        //check, save單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
        //insert之錯誤皆屬整批性而reject, 其回傳為聚合物件而非逐筆陣列, 故不須檢查
        if (mode === 'save') {
            let fails = getItemsFail(r, input)
            if (size(fails) > 0) {
                console.log(`${woName}.save fail`, fails)
                return Promise.reject(getMsgFail('failed to save data', getItemsFail(r, inputOrig)))
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

        //castIdRows, 主鍵之有限數字轉為字串, 寫於複本(R-ID-02); 刪除不經clearXSS(R-XSS-01)
        if (idCast) {
            input = castIdRows(input)
        }

        //del
        r = await wo.del(input)
            .catch((msg) => {
                console.log(`${woName}.del catch`, msg)
                err = 'failed to delete data'
            })

        //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
        if (!isestr(err)) {
            let fails = getItemsFail(r, input)
            if (size(fails) > 0) {
                console.log(`${woName}.del fail`, fails)
                err = getMsgFail('failed to delete data', fails)
            }
        }

    }
    else if (mode === 'delAll') {

        //check, 條件若給予須為一般物件(R-INPUT-01 規則3): 各後端對非物件之條件一律視為無條件而刪除全表; 未給(undefined)與空物件依規格為刪除全部; 另不得含自有__proto__鍵(R-OBJ-01 規則3)
        let errFind = getErrFind('delAll', input)
        if (errFind !== null) {
            logSafe(`${woName}.delAll invalid find`, input)
            return Promise.reject(errFind)
        }

        //delAll, 條件中主鍵之比較值轉型(R-ID-02)
        r = await wo.delAll(idCast ? castIdFind(input) : input)
            .catch((msg) => {
                console.log(`${woName}.delAll catch`, msg)
                err = 'failed to delete data'
            })

    }
    else if (mode === 'mix') {

        //check
        if (!iseobj(input)) {
            return Promise.reject('invalid input of mix, need the result object of ltdtDiffByKey')
        }

        //check, add、del、diff為存取器者整批拒絕(R-OBJ-01 規則3 批次容器), 並取快照(各讀一次, 其後只用快照), 使各檢查與寫入所見一致
        for (let key of ['add', 'del', 'diff']) {
            let d = Object.getOwnPropertyDescriptor(input, key)
            if (d !== undefined && (d.get !== undefined || d.set !== undefined)) {
                return Promise.reject(`invalid input of mix, ${MSGS_BAD_KEY.accessor}`)
            }
        }
        input = { add: input.add, del: input.del, diff: input.diff }

        //check, add、del、diff若給予須為陣列(R-INPUT-01), 否則各段之回傳將逐欄位產生
        for (let key of ['add', 'del', 'diff']) {
            if (input[key] !== undefined && !isarr(input[key])) {
                return Promise.reject('invalid input of mix, need the result object of ltdtDiffByKey')
            }
        }

        //check, 新增與修改之各筆須為一般物件, 於任何步驟寫入之前整批拒絕(R-INPUT-01)
        let msgsNotObj = []
        for (let [key, msg] of [['add', 'failed to insert data'], ['diff', 'failed to update data']]) {
            let fails = getItemsNotObj(get(input, key, []))
            if (size(fails) > 0) {
                console.log(`${woName}.mix ${key} data is not an object`, fails)
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
            console.log(`${woName}.mix data has unsupported key`, msgsBadKey)
            return Promise.reject(join(msgsBadKey, '; '))
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
                console.log(`${woName}.mix ${key} id changed by clearXSS`, fails)
                msgsIdXSS.push(getMsgIdXSS(msg, fails))
            }
        }
        if (size(msgsIdXSS) > 0) {
            return Promise.reject(join(msgsIdXSS, '; '))
        }

        //check, add與del、del與diff同鍵者, 於任何步驟寫入之前整批拒絕(R-MIX-01)
        let msgsSameId = getMsgsMixSameId(input)
        if (size(msgsSameId) > 0) {
            console.log(`${woName}.mix same id across steps`, msgsSameId)
            return Promise.reject(join(msgsSameId, '; '))
        }

        //rt,r
        let rt
        r = [] //default to array

        //msgsFail, 逐筆失敗僅影響該筆, 不中斷後續步驟, 待全部步驟完成後一併reject; 整批性錯誤則仍立即reject
        let msgsFail = []

        let add = get(input, 'add', [])
        if (size(add) > 0) {

            //adjustData
            try {
                add = adjustData(ds, woName, userId, add, 'insert+save')
            }
            catch (e) {
                console.log(`${woName}.adjustData catch`, e.toString())
                err = 'failed to adjust data'
                return Promise.reject(err)
            }

            //insert
            await wo.insert(add)
                .catch((msg) => {
                    console.log(`${woName}.insert catch`, msg)
                    err = 'failed to insert data'
                })

            //check
            if (isestr(err)) {
                return Promise.reject(err)
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
                    console.log(`${woName}.del catch`, msg)
                    err = 'failed to delete data'
                })

            //check
            if (isestr(err)) {
                return Promise.reject(err)
            }

            //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
            let fails = getItemsFail(rs, del)
            if (size(fails) > 0) {
                console.log(`${woName}.del fail`, fails)
                msgsFail.push(getMsgFail('failed to delete data', fails))
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

            //adjustData
            try {
                diff = adjustData(ds, woName, userId, diff)
            }
            catch (e) {
                console.log(`${woName}.adjustData catch`, e.toString())
                err = 'failed to adjust data'
                return Promise.reject(err)
            }

            //save
            let rs = await wo.save(diff)
                .catch((msg) => {
                    console.log(`${woName}.save catch`, msg)
                    err = 'failed to update data'
                })

            //check
            if (isestr(err)) {
                return Promise.reject(err)
            }

            //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
            let fails = getItemsFail(rs, diff)
            if (size(fails) > 0) {
                console.log(`${woName}.save fail`, fails)
                msgsFail.push(getMsgFail('failed to update data', getItemsFail(rs, diffOrig)))
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


function getMapOrm(ds, woItems) {
    //每次呼叫各自綁定ds與woItems並回傳新函數, 令同一行程內之多個實例互不干擾; 回傳函數之參數形狀維持(userId, woName, mode, input)
    return async (userId, woName, mode, input) => {
        return mapOrm(ds, woItems, userId, woName, mode, input)
    }
}


export default getMapOrm
