const fs=require('node:fs/promises');const path=require('node:path');const asar=require('@electron/asar');
(async()=>{
 const root=path.resolve(__dirname,'..');const out=process.argv[3]?path.resolve(process.argv[3]):path.join(root,'windows-build','win-unpacked');
 const stage=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'node_modules','.cache','manny-package','app');
 await fs.mkdir(stage,{recursive:true});await fs.mkdir(out,{recursive:true});
 for(const name of ['dist','electron','shared'])await fs.cp(path.join(root,name),path.join(stage,name),{recursive:true});
 const source=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
 await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({name:source.name,version:source.version,productName:'Manny Animation Studio',description:source.description,author:source.author,main:'electron/main.cjs'},null,2));
 await fs.cp(path.join(root,'node_modules','electron','dist'),out,{recursive:true});
 await fs.mkdir(path.join(out,'resources','backend'),{recursive:true});
 await fs.copyFile(path.join(root,'electron','refresh-file-associations.ps1'),path.join(out,'resources','refresh-file-associations.ps1'));
 await asar.createPackage(stage,path.join(out,'resources','app.asar'));
 for(const name of ['export_fbx.py','export_shared.py','import_shared_unreal.py','import_asset.py','import_character.py','export_character.py','manny-clean.blend','skeleton.json'])await fs.copyFile(path.join(root,'backend',name),path.join(out,'resources','backend',name));
 for(const name of ['README.md','UNREAL-SETUP.md','THIRD-PARTY-NOTICES.txt'])await fs.copyFile(path.join(root,name),path.join(out,name));
 const incoming=path.join(out,'electron.exe'),executable=path.join(out,'Manny Animation Studio.exe');
 // Avoid replacing an identical Electron binary on Windows; packaged resources carry app updates.
 const existing=await fs.readFile(executable).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(existing&&existing.equals(await fs.readFile(incoming)))await fs.unlink(incoming);else await fs.rename(incoming,executable);
 console.log('Portable app ready: '+path.join(out,'Manny Animation Studio.exe'));
})().catch(e=>{console.error(e);process.exitCode=1;});
