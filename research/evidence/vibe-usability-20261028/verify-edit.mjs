import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {atLeast}=await import(pathToFileURL(process.argv[2]));
const cases=[[699,700,false],[700,700,true],[701,700,true],[-3,-2,false],[-2,-2,true],[-1,-2,true],[0,0,true],[-0,0,true],[NaN,1,false],[1,NaN,false],[Infinity,Infinity,true],[-Infinity,Infinity,false],[Infinity,1,true],[-Infinity,-Infinity,true]];
for(const [a,b,want] of cases) assert.equal(atLeast(a,b),want);
console.log(`${cases.length} independent semantic cases passed`);
