import tests from './tables/tests.mjs'
import build from 'w-data-collector/src/build.mjs'


let cs = {
    tests,
}

//ds
let ds = {}
for (let k in cs) {
    ds[k] = build(cs[k], { useCreateStorage: false })
}


export default ds
