package studio.pose.editor;

import com.getcapacitor.BridgeActivity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.view.View;
import android.view.Display;
import android.view.WindowManager;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    private final java.util.ArrayDeque<Uri> pendingProjects = new java.util.ArrayDeque<>();
    @Override public void onCreate(Bundle state) {
        registerPlugin(PoseFilesPlugin.class);
        registerPlugin(PoseUpdatesPlugin.class);
        super.onCreate(state);
        immersive();
        getWindow().getDecorView().post(this::preferHighRefreshRate);
        acceptIntent(getIntent());
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { files().back(); }
        });
    }
    private void immersive() {
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.systemBars());
    }
    @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused) { immersive(); preferHighRefreshRate(); } }
    // Request cadence, not a resolution change. Android still owns power/thermal policy.
    private void preferHighRefreshRate() {
        Display display = getWindow().getDecorView().getDisplay();
        if (display == null) return;
        Display.Mode current = display.getMode();
        Display.Mode preferred = current;
        float rate = current.getRefreshRate();
        for (Display.Mode mode : display.getSupportedModes()) {
            if (mode.getPhysicalWidth() == current.getPhysicalWidth() && mode.getPhysicalHeight() == current.getPhysicalHeight() && mode.getRefreshRate() > rate) {
                preferred = mode;
                rate = mode.getRefreshRate();
            }
        }
        WindowManager.LayoutParams attributes = getWindow().getAttributes();
        if (attributes.preferredRefreshRate != rate || attributes.preferredDisplayModeId != preferred.getModeId()) {
            attributes.preferredRefreshRate = rate;
            attributes.preferredDisplayModeId = preferred.getModeId();
            getWindow().setAttributes(attributes);
        }
        // A window preference does not propagate to WebView's adaptive-rate vote.
        if (Build.VERSION.SDK_INT >= 35 && getBridge() != null) {
            getWindow().getDecorView().setRequestedFrameRate(View.REQUESTED_FRAME_RATE_CATEGORY_HIGH);
            getBridge().getWebView().setRequestedFrameRate(View.REQUESTED_FRAME_RATE_CATEGORY_HIGH);
        }
    }
    private PoseFilesPlugin files() { return (PoseFilesPlugin)getBridge().getPlugin("PoseFiles").getInstance(); }
    private void acceptIntent(Intent intent) {
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) { pendingProjects.add(intent.getData()); files().queued(); }
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); acceptIntent(intent); }
    public Uri takeProjectUri() { return pendingProjects.poll(); }
}
