/** Preserve the exact Markdown source; folding changes only its visible height. */
export function messageBodyView(value) {
 const source=typeof value==='string'?value:String(value??'');
 const code=source.match(/^\s*(`{3,}|~{3,})[^\n]*\r?\n([\s\S]*?)\r?\n\1\s*$/);
 const previewLines=code?12:8;
 const lineCount=(code?code[2]:source).split(/\r?\n/).length;
 return {source,previewLines,codeOnly:!!code,collapsible:lineCount>previewLines||source.length>900};
}
export const copyMessageSource = async (source,clipboard) => {
 if(typeof clipboard?.writeText!=='function')return {status:'unavailable'};
 try{await clipboard.writeText(source);return {status:'copied'};}catch{return {status:'failed'};}
};
