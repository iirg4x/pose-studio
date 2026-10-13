const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const PROJECT_FILTERS=[{name:'Pose project',extensions:['pose']},{name:'Legacy JSON project',extensions:['json']}];
function projectFilename(name){return String(name||'Untitled project').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/(?:\.pose|\.manny)?\.json$|\.pose$/i,'').replace(/[. ]+$/,'')+'.pose';}
function projectSavePath(filename){return path.join(path.dirname(filename),projectFilename(path.basename(filename)));}
function projectArguments(argv,cwd=process.cwd(),packaged=true){
 // Skip the executable and, in development, Electron's app entry point.
 return argv.slice(packaged?1:2).filter(arg=>!arg.startsWith('-')&&/\.(pose|json)$/i.test(arg)).map(arg=>path.resolve(cwd,arg));
}
function createProjectQueue(){
 const pending=[];
 return {add(filename){if(pending.at(-1)!==filename)pending.push(filename);},take(){return pending.shift();}};
}
function associationEntries(executable){
 const root='HKCU\\Software\\Classes',type='Pose.Project';
 return [
  [root+'\\.pose',type],
  [root+'\\'+type,'Pose project'],
  [root+'\\'+type+'\\DefaultIcon','"'+executable+'",0'],
  [root+'\\'+type+'\\shell\\open\\command','"'+executable+'" "%1"'],
 ];
}
async function registerProjectAssociation(executable,refreshScript=path.join(__dirname,'refresh-file-associations.ps1')){
 if(process.platform!=='win32')return;
 for(const [key,value] of associationEntries(executable))await run('reg.exe',['add',key,'/ve','/t','REG_SZ','/d',value,'/f'],{windowsHide:true});
 // Explorer caches extension handlers; notify it so double-click works immediately.
 await run('powershell.exe',['-NoProfile','-NonInteractive','-File',refreshScript],{windowsHide:true});
}
module.exports={PROJECT_FILTERS,projectFilename,projectSavePath,projectArguments,createProjectQueue,associationEntries,registerProjectAssociation};
