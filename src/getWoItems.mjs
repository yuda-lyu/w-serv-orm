import get from 'lodash/get'
import each from 'lodash/each'
import keys from 'lodash/keys'
import size from 'lodash/size'
import isfun from 'wsemi/src/isfun'
import iseobj from 'wsemi/src/iseobj'
import isestr from 'wsemi/src/isestr'


function getWoItems(ds, WOrm, opt = {}) {

    //check ds
    if (size(ds) === 0) {
        console.log('ds', ds)
        throw new Error('invalid ds')
    }

    //check WOrm
    if (!isfun(WOrm)) {
        console.log('WOrm', WOrm)
        throw new Error('invalid WOrm')
    }

    //check opt
    if (!iseobj(opt)) {
        console.log('opt', opt)
        throw new Error('invalid opt')
    }

    //url
    let url = get(opt, 'url')
    if (!isestr(url)) {
        console.log('url', url)
        throw new Error('invalid url')
    }

    //db
    let db = get(opt, 'db')
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
