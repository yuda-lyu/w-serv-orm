import each from 'lodash-es/each.js'
import keys from 'lodash-es/keys.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { getDiag, getBriefType } from './getDiag.mjs'


function getWoItems(ds, WOrm, url, db, optLog = undefined) {
    //optLog(選用, 內部): getDiag可收之{ logDetail, funLog }, 無效參數之診斷輸出依其設定(R-DIAG-01): 預設只列型別, 不列呼叫端傳入之無效值(可能含連線字串帳密等)

    //diag
    let diag = getDiag(optLog)

    //check ds
    if (!iseobj(ds)) {
        diag('ds', getBriefType(ds), () => ds)
        throw new Error('invalid ds')
    }

    //check WOrm
    if (!isfun(WOrm)) {
        diag('WOrm', getBriefType(WOrm), () => WOrm)
        throw new Error('invalid WOrm')
    }

    //check url
    if (!isestr(url)) {
        diag('url', getBriefType(url), () => url)
        throw new Error('invalid url')
    }

    //check db
    if (!isestr(db)) {
        diag('db', getBriefType(db), () => db)
        throw new Error('invalid db')
    }

    //woItems
    let woItems = {}
    each(keys(ds), (v) => {

        //useOpt
        let useOpt = { url, db, cl: v }

        //wo
        let wo = new WOrm(useOpt)

        //save, 以defineProperty建立自有屬性: 不用woItems[v]=wo, ds之鍵為__proto__時會改設woItems之原型而該表不可用(R-INPUT-01 規則5)
        Object.defineProperty(woItems, v, { value: wo, enumerable: true, writable: true, configurable: true })

        // //change, 當數據有改變時清除快取
        // wo.on('change', (mode) => {
        //     //console.log(`${v} change`, mode)
        //     cache.clear(`${v}.select`) //變更後會馬上重撈資料, 故需直接清除快取
        // })

    })

    return woItems
}


export default getWoItems
