const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
// Android Studio writes local.properties; CI may supply ANDROID_HOME instead.
if(!process.env.ANDROID_HOME&&!process.env.ANDROID_SDK_ROOT&&!fs.existsSync(path.join(root,'android/local.properties'))){
 console.error('Install Android SDK 36, then set ANDROID_HOME or open android/ in Android Studio. JDK 21 or newer is required.');process.exit(1);
}
const result=spawnSync(process.platform==='win32'?'gradlew.bat':'./gradlew',['--no-daemon','assembleDebug'],{cwd:path.join(root,'android'),stdio:'inherit',shell:process.platform==='win32'});
if(result.status!==0)process.exit(result.status??1);
const version=require('../package.json').version,destination=path.join(root,'android-build','Pose-'+version+'-android.apk');
fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(root,'android/app/build/outputs/apk/debug/app-debug.apk'),destination);console.log('APK: '+destination);
