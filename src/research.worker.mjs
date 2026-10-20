import {runResearch} from './research.mjs';
self.onmessage=({data:{data,manifest,config}})=>{try{const result=runResearch(data,manifest,config,progress=>self.postMessage({type:'progress',progress}));self.postMessage({type:'done',result});}catch(e){self.postMessage({type:'error',message:e.message});}};
