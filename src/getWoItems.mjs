import each from 'lodash-es/each.js'
import keys from 'lodash-es/keys.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'


function getWoItems(ds, WOrm, url, db) {

    //check ds
    if (!iseobj(ds)) {
        console.log('ds', ds)
        throw new Error('invalid ds')
    }

    //check WOrm
    if (!isfun(WOrm)) {
        console.log('WOrm', WOrm)
        throw new Error('invalid WOrm')
    }

    //check url
    if (!isestr(url)) {
        console.log('url', url)
        throw new Error('invalid url')
    }

    //check db
    if (!isestr(db)) {
        console.log('db', db)
        throw new Error('invalid db')
    }

    //woItems
    let woItems = {}
    each(keys(ds), (v) => {

        //useOpt
        let useOpt = { url, db, cl: v }

        //wo
        let wo = new WOrm(useOpt)

        //save
        woItems[v] = wo

        // //change, 當數據有改變時清除快取
        // wo.on('change', (mode) => {
        //     //console.log(`${v} change`, mode)
        //     cache.clear(`${v}.select`) //變更後會馬上重撈資料, 故需直接清除快取
        // })

    })

    return woItems
}


export default getWoItems
