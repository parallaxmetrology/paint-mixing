const {test}=require("node:test");
const assert=require("node:assert/strict");
const M=require("../src/reach-mix.js");
test("white detection ignores capitalization",()=>{for(const name of ["Titanium White","lead white","ZINC WHITE"])assert(M.isWhite({name}));assert.equal(M.isWhite({name:"Ultramarine Blue"}),false)});
