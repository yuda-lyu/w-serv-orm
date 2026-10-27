import path from 'path'
import fs from 'fs'
import JSON5 from 'json5'
import get from 'lodash-es/get.js'
import isnum from 'wsemi/src/isnum.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import { getOptLogLoose, getDiag, getBriefErr } from './getDiag.mjs'


let fdSrv = path.resolve()

//設定檔的已知鍵: 診斷輸出的預設摘要只列這些鍵是否存在(設定檔的鍵名由部署者撰寫, 未知鍵不列, R-DIAG-01)
const KEYS_KNOWN = ['dbUrl', 'dbType', 'dbUsername', 'dbPassword', 'dbIP', 'dbPort', 'dbName']


function getSettings(opt = {}) {

    //fn
    let fn = get(opt, 'fn')
    if (!isestr(fn)) {
        fn = 'settings.json'
    }

    //fp
    let fp = path.resolve(fdSrv, fn) //`${fdSrv}/${fn}`

    //diag, 設定檔無效時之診斷輸出預設只列設定檔有哪些鍵(設定值含資料庫帳號與密碼), opt.logDetail為true還原完整傾印, opt.funLog收完整細節(R-DIAG-01); 型別錯誤者忽略
    let diag = getDiag(getOptLogLoose(opt))

    //st
    let st = {}
    let logSt = () => {
        let ks = iseobj(st) ? Object.keys(st) : []
        diag('st', { keys: ks.filter((v) => KEYS_KNOWN.indexOf(v) >= 0), nOther: ks.filter((v) => KEYS_KNOWN.indexOf(v) < 0).length }, () => st)
    }
    try {

        //readFileSync
        let j = fs.readFileSync(fp, 'utf8')

        //parse
        st = JSON5.parse(j)

        //url
        let url = ''
        if (isestr(get(st, 'dbUrl'))) {
            url = st.dbUrl
        }
        else {
            if (!isestr(get(st, 'dbType'))) {
                logSt()
                throw new Error(`invalid st.dbType`)
            }
            if (!isestr(get(st, 'dbUsername'))) {
                logSt()
                throw new Error(`invalid st.dbUsername`)
            }
            if (!isestr(get(st, 'dbPassword'))) {
                logSt()
                throw new Error(`invalid st.dbPassword`)
            }
            if (!isestr(get(st, 'dbIP'))) {
                logSt()
                throw new Error(`invalid st.dbIP`)
            }
            if (!isnum(get(st, 'dbPort'))) {
                logSt()
                throw new Error(`invalid st.dbPort`)
            }
            url = `${st.dbType}://${st.dbUsername}:${st.dbPassword}@${st.dbIP}:${st.dbPort}`
        }

        //db
        if (!isestr(get(st, 'dbName'))) {
            logSt()
            throw new Error(`invalid st.dbName`)
        }
        let db = st.dbName

        //merge
        st = {
            ...st,
            url,
            db,
        }

    }
    catch (err) {
        //err可為檔案系統錯誤(含檔案路徑)或JSON5解析錯誤, 預設只列錯誤類別; 舊版為console.log(err)
        diag('getSettings catch', getBriefErr(err), () => err, true)
        throw new Error('failed to read settings file')
    }

    return st
}


export default getSettings
