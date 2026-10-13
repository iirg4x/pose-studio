package studio.pose.editor;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** The channel contains app releases only. Project documents use their own scoped grants. */
@CapacitorPlugin(name = "PoseUpdates")
public class PoseUpdatesPlugin extends Plugin {
    private static final String CHANNEL = "https://github.com/iirg4x/pose-releases/releases/latest/download/pose-update.json";
    private final java.util.concurrent.ExecutorService worker = Executors.newSingleThreadExecutor();
    private JSONObject release;
    private File apk() { return new File(getContext().getCacheDir(), "pose-update.apk"); }
    private File metadata() { return new File(getContext().getCacheDir(), "pose-update.json"); }
    private static String hex(byte[] bytes) { StringBuilder s = new StringBuilder(); for (byte b : bytes) s.append(String.format("%02x", b)); return s.toString(); }
    private static String digest(File file) throws Exception {
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) { byte[] buffer = new byte[65536]; int n; while ((n = in.read(buffer)) != -1) hash.update(buffer, 0, n); }
        return hex(hash.digest());
    }
    private static HttpURLConnection connect(String address) throws Exception {
        URL url = new URL(address);
        for (int redirects = 0; redirects < 6; redirects++) {
            String host = url.getHost();
            if (!url.getProtocol().equals("https") || !(host.equals("github.com") || host.equals("release-assets.githubusercontent.com") || host.equals("objects.githubusercontent.com"))) throw new IOException("Untrusted update address.");
            HttpURLConnection c = (HttpURLConnection)url.openConnection(); c.setConnectTimeout(15000); c.setReadTimeout(30000); c.setInstanceFollowRedirects(false); c.setRequestProperty("User-Agent", "Pose-Android-Updater"); c.setRequestProperty("Cache-Control", "no-cache");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) { String location = c.getHeaderField("Location"); c.disconnect(); if (location == null) throw new IOException("Invalid update redirect."); url = new URL(url, location); continue; }
            if (code != 200) { c.disconnect(); throw new IOException("Update server returned " + code + ". Try again later."); }
            return c;
        }
        throw new IOException("Too many update redirects.");
    }
    private JSONObject channel() throws Exception {
        HttpURLConnection c = connect(CHANNEL);
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] b = new byte[4096]; int n; while ((n = in.read(b)) != -1) { if (out.size() + n > 32768) throw new IOException("Invalid update manifest."); out.write(b, 0, n); }
            JSONObject manifest = new JSONObject(out.toString(StandardCharsets.UTF_8.name())), r = manifest.getJSONObject("android");
            String url = r.getString("url"), hash = r.getString("sha256"); long size = r.getLong("size");
            if (manifest.getInt("schema") != 1 || r.getInt("versionCode") < 1 || !r.getString("version").matches("[0-9]+\\.[0-9]+\\.[0-9]+") || !url.startsWith("https://github.com/iirg4x/pose-releases/releases/download/") || !hash.matches("[a-f0-9]{64}") || size < 1024 || size > 256L*1024*1024) throw new IOException("Invalid update manifest.");
            return r;
        } finally { c.disconnect(); }
    }
    private boolean ready(JSONObject r) throws Exception {
        if (!apk().isFile() || !metadata().isFile() || apk().length() != r.getLong("size")) return false;
        try (InputStream in = new FileInputStream(metadata())) { JSONObject saved = new JSONObject(new String(readMetadata(in), StandardCharsets.UTF_8)); return saved.getString("sha256").equals(r.getString("sha256")); }
    }
    private JSObject status(JSONObject r) throws Exception {
        JSObject value = new JSObject(); value.put("currentVersion", BuildConfig.VERSION_NAME); value.put("currentCode", BuildConfig.VERSION_CODE);
        value.put("available", r.getInt("versionCode") > BuildConfig.VERSION_CODE); value.put("version", r.getString("version")); value.put("size", r.getLong("size")); value.put("notes", r.optString("notes", "")); value.put("ready", ready(r));
        ConnectivityManager network = (ConnectivityManager)getContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
        value.put("metered", network == null || network.isActiveNetworkMetered()); return value;
    }
    @PluginMethod public void check(PluginCall call) { worker.execute(() -> { try { release = channel(); call.resolve(status(release)); } catch (Exception e) { call.reject(e.getMessage()); } }); }
    private long version(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    private int signatureFlags() { return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES; }
    private static byte[] readMetadata(InputStream in) throws IOException { ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[4096]; int n; while ((n = in.read(b)) != -1) { if (out.size()+n > 32768) throw new IOException("Invalid cached update metadata."); out.write(b,0,n); } return out.toByteArray(); }
    private Set<String> signers(PackageInfo info) throws Exception {
        if (info == null || (Build.VERSION.SDK_INT >= 28 && info.signingInfo == null)) throw new IOException("Cannot verify app signature.");
        Set<String> result = new HashSet<>(); for (Signature signature : (Build.VERSION.SDK_INT >= 28 ? info.signingInfo.getApkContentsSigners() : info.signatures)) result.add(hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()))); return result;
    }
    private void verify(File file, JSONObject r) throws Exception {
        if (file.length() != r.getLong("size") || !digest(file).equals(r.getString("sha256"))) throw new IOException("Update checksum mismatch. Download it again.");
        PackageManager pm = getContext().getPackageManager(); PackageInfo incoming = pm.getPackageArchiveInfo(file.getAbsolutePath(), signatureFlags()), current = pm.getPackageInfo(getContext().getPackageName(), signatureFlags());
        if (incoming == null || !getContext().getPackageName().equals(incoming.packageName) || version(incoming) != r.getLong("versionCode") || version(incoming) <= version(current) || !signers(incoming).equals(signers(current))) throw new IOException("This update does not match the installed Pose app.");
    }
    @PluginMethod public void download(PluginCall call) { worker.execute(() -> {
        File part = new File(getContext().getCacheDir(), "pose-update.part");
        try {
            if (release == null) release = channel(); if (release.getInt("versionCode") <= BuildConfig.VERSION_CODE) { call.resolve(status(release)); return; }
            if (ready(release)) { verify(apk(), release); call.resolve(status(release)); return; }
            HttpURLConnection c = connect(release.getString("url"));
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buffer = new byte[65536]; long count = 0, reported = 0, expected = release.getLong("size"); int n;
                while ((n = in.read(buffer)) != -1) { count += n; if (count > expected) throw new IOException("Update exceeded the expected size."); out.write(buffer, 0, n); if (count - reported > 512*1024) { JSObject progress = new JSObject(); progress.put("progress", (double)count/expected); notifyListeners("progress", progress); reported = count; } }
            } finally { c.disconnect(); }
            verify(part, release); if (apk().exists() && !apk().delete()) throw new IOException("Could not replace cached update."); if (!part.renameTo(apk())) throw new IOException("Could not cache update.");
            try (OutputStream out = new FileOutputStream(metadata())) { out.write(release.toString().getBytes(StandardCharsets.UTF_8)); }
            call.resolve(status(release));
        } catch (Exception e) { part.delete(); call.reject(e.getMessage()); }
    }); }
    @PluginMethod public void install(PluginCall call) { worker.execute(() -> { try {
        if (release == null) { try (InputStream in = new FileInputStream(metadata())) { release = new JSONObject(new String(readMetadata(in), StandardCharsets.UTF_8)); } }
        verify(apk(), release);
        getActivity().runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) { getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))); JSObject result = new JSObject(); result.put("permissionNeeded", true); call.resolve(result); return; }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName()+".fileprovider", apk());
                getActivity().startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); call.resolve();
            } catch (Exception e) { call.reject(e.getMessage()); }
        });
    } catch (Exception e) { call.reject(e.getMessage()); } }); }
    @Override protected void handleOnResume() { notifyListeners("resume", new JSObject()); }
    @Override protected void handleOnDestroy() { worker.shutdownNow(); }
}
