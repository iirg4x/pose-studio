package studio.pose.editor;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.util.*;

/** Scoped document access. No filesystem/storage permission or server is required. */
@CapacitorPlugin(name = "PoseFiles")
public class PoseFilesPlugin extends Plugin {
    private static final int CHUNK = 768 * 1024;
    private static final long MAX = 512L * 1024 * 1024;
    private final Map<String, File> streams = new HashMap<>();
    private final Map<String, Uri> destinations = new HashMap<>();
    private boolean picking;

    private String name(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        return "Project.pose";
    }
    private JSObject cacheDocument(Uri uri) throws IOException {
        String id = UUID.randomUUID().toString();
        File file = new File(getContext().getCacheDir(), "pose-read-" + id);
        try (InputStream in = getContext().getContentResolver().openInputStream(uri); OutputStream out = new FileOutputStream(file)) {
            if (in == null) throw new IOException("Could not read this document.");
            byte[] buffer = new byte[65536]; long total = 0; int count;
            while ((count = in.read(buffer)) != -1) {
                total += count;
                if (total > MAX) throw new IOException("Choose a document below 512 MB.");
                out.write(buffer, 0, count);
            }
        } catch (Exception e) { file.delete(); throw e; }
        streams.put(id, file);
        JSObject result = new JSObject(); result.put("id", id); result.put("name", name(uri)); result.put("uri", uri.toString()); result.put("size", file.length()); return result;
    }
    @PluginMethod public void open(PluginCall call) {
        if (picking) { call.reject("Finish the current file picker first."); return; }
        picking = true;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "opened");
    }
    @ActivityCallback private void opened(PluginCall call, ActivityResult result) {
        picking = false; if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(); return; }
        Uri uri = result.getData().getData();
        try {
            try { getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (SecurityException ignored) {}
            call.resolve(cacheDocument(uri));
        } catch (Exception e) { call.reject("Could not open document: " + e.getMessage()); }
    }
    @PluginMethod public void openUri(PluginCall call) {
        try { call.resolve(cacheDocument(Uri.parse(call.getString("uri", "")))); }
        catch (Exception e) { call.reject("Document unavailable. Open it again from Files: " + e.getMessage()); }
    }
    @PluginMethod public void read(PluginCall call) {
        try {
            File file = streams.get(call.getString("id")); if (file == null) throw new IOException("Document closed.");
            long position = call.getData().optLong("position", 0L); if (position < 0 || position > file.length()) throw new IOException("Invalid read position.");
            byte[] bytes = new byte[(int)Math.min(CHUNK, file.length() - position)];
            try (RandomAccessFile input = new RandomAccessFile(file, "r")) { input.seek(position); input.readFully(bytes); }
            JSObject value = new JSObject(); value.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)); call.resolve(value);
        } catch (Exception e) { call.reject(e.getMessage()); }
    }
    @PluginMethod public void create(PluginCall call) {
        if (picking) { call.reject("Finish the current file picker first."); return; }
        picking = true;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(call.getString("mime", "application/octet-stream")).putExtra(Intent.EXTRA_TITLE, call.getString("name", "Project.pose"));
        startActivityForResult(call, intent, "created");
    }
    @ActivityCallback private void created(PluginCall call, ActivityResult result) {
        picking = false; if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(); return; }
        try {
            String id = UUID.randomUUID().toString(); Uri uri = result.getData().getData();
            try { getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (SecurityException ignored) {}
            File file = File.createTempFile("pose-write-", ".tmp", getContext().getCacheDir());
            streams.put(id, file); destinations.put(id, uri);
            JSObject value = new JSObject(); value.put("id", id); value.put("path", name(uri)); value.put("uri", uri.toString()); call.resolve(value);
        } catch (Exception e) { call.reject(e.getMessage()); }
    }
    @PluginMethod public void write(PluginCall call) {
        try {
            String id = call.getString("id"); File file = streams.get(id);
            if (file == null || !destinations.containsKey(id)) throw new IOException("Export closed.");
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT); long position = call.getData().optLong("position", 0L);
            if (bytes.length > CHUNK || position < 0 || position + bytes.length > 4L * 1024 * 1024 * 1024) throw new IOException("Invalid export chunk.");
            try (RandomAccessFile out = new RandomAccessFile(file, "rw")) { out.seek(position); out.write(bytes); }
            call.resolve();
        } catch (Exception e) { call.reject("Could not write export: " + e.getMessage()); }
    }
    @PluginMethod public void finish(PluginCall call) {
        String id = call.getString("id");
        try {
            Uri uri = destinations.get(id); File file = streams.get(id);
            if (uri == null || file == null) throw new IOException("Export closed.");
            try (InputStream in = new FileInputStream(file); OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (out == null) throw new IOException("Destination is not writable.");
                byte[] buffer = new byte[65536]; int count;
                while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
            }
            JSObject value = new JSObject(); value.put("path", name(uri)); value.put("uri", uri.toString()); call.resolve(value); cleanup(id);
        } catch (Exception e) { call.reject("Could not finish export: " + e.getMessage()); }
    }
    private void cleanup(String id) { File file = streams.remove(id); if (file != null) file.delete(); destinations.remove(id); }
    @PluginMethod public void close(PluginCall call) { cleanup(call.getString("id")); call.resolve(); }
    @PluginMethod public void takeProject(PluginCall call) {
        Uri uri = ((MainActivity)getActivity()).takeProjectUri();
        if (uri == null) { call.resolve(); return; }
        try { call.resolve(cacheDocument(uri)); } catch (Exception e) { call.reject(e.getMessage()); }
    }
    public void queued() { notifyListeners("projectQueued", new JSObject(), true); }
    public void back() { notifyListeners("closeRequest", new JSObject(), true); }
    @PluginMethod public void exit(PluginCall call) { call.resolve(); getActivity().runOnUiThread(() -> getActivity().finish()); }
    @Override protected void handleOnDestroy() { for (File file : streams.values()) file.delete(); streams.clear(); destinations.clear(); }
}
