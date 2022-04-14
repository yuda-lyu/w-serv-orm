import path from 'path'
import fs from 'fs'
import JSON5 from 'json5'
import get from 'lodash/get'
import isnum from 'wsemi/src/isnum.mjs'
import isestr from 'wsemi/src/isestr.mjs'


let fdSrv = path.resolve()


function getSettings(opt = {}) {

    //fn
    let fn = get(opt, 'fn')
    if (!isestr(fn)) {
        fn = 'settings.json'
    }

    //fp
    let fp = path.resolve(fdSrv, fn) //`${fdSrv}/${fn}`

    //st
    let st = {}
    try {

        //readFileSync
        let j = fs.readFileSync(fp, 'utf8')

        //parse
        st = JSON5.parse(j)

        //check
        if (!isestr(get(st, 'dbType'))) {
            console.log('invalid st.dbType', st.dbType)
        }
        if (!isestr(get(st, 'dbUsername'))) {
            console.log('invalid st.dbUsername', st.dbUsername)
        }
        if (!isestr(get(st, 'dbPassword'))) {
            console.log('invalid st.dbPassword', st.dbPassword)
        }
        if (!isestr(get(st, 'dbIP'))) {
            console.log('invalid st.dbIP', st.dbIP)
        }
        if (!isnum(get(st, 'dbPort'))) {
            console.log('invalid st.dbPort', st.dbPort)
        }
        if (!isestr(get(st, 'dbType'))) {
            console.log('invalid st.dbType', st.dbType)
        }

        //url, db
        let url = `${st.dbType}://${st.dbUsername}:${st.dbPassword}@${st.dbIP}:${st.dbPort}`
        let db = st.dbName

        //merge
        st = {
            ...st,
            url,
            db,
        }

    }
    catch (err) {
        console.log(err)
        throw new Error('伺服器讀取設定檔失敗')
    }

    return st
}


export default getSettings
