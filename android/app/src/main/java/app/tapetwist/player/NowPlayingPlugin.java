package app.tapetwist.player;

import android.app.Activity;
import android.content.Context;
import android.os.Build;
import android.os.PowerManager;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The page's side of PlaybackService: app/utils/native.ts. */
@CapacitorPlugin(name = "NowPlaying")
public class NowPlayingPlugin extends Plugin {
    private PowerManager.WakeLock screenLock;

    @Override
    public void load() {
        PlaybackService.listener = (action) -> {
            JSObject e = new JSObject();
            e.put("action", action);
            notifyListeners("action", e);
        };
    }

    @PluginMethod
    public void update(PluginCall call) {
        PlaybackService.show(getContext(),
                call.getString("title", "Tape Twist"),
                call.getString("artist", ""),
                call.getBoolean("playing", true));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        PlaybackService.hide(getContext());
        call.resolve();
    }

    /**
     * The light show: turns the screen on (even locked, even in a pocket) and shows the app over
     * the lock screen while on; off gives the screen back to the lock screen and its timeout.
     */
    @PluginMethod
    public void wake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        setWake(on);
        call.resolve();
    }

    @SuppressWarnings("deprecation") // SCREEN_BRIGHT + ACQUIRE_CAUSES_WAKEUP: still the way to light the screen up
    private void setWake(boolean on) {
        Activity a = getActivity();
        if (a != null) {
            a.runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                    a.setShowWhenLocked(on);
                    a.setTurnScreenOn(on);
                } else {
                    int f = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
                    if (on) a.getWindow().addFlags(f);
                    else a.getWindow().clearFlags(f);
                }
            });
        }
        if (on) {
            if (screenLock == null) {
                PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                screenLock = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "tapetwist:lights");
                screenLock.setReferenceCounted(false);
            }
            screenLock.acquire(10 * 60 * 1000L); // a lost "off" can't keep it lit for ever
        } else if (screenLock != null && screenLock.isHeld()) {
            screenLock.release();
        }
    }

    @Override
    protected void handleOnDestroy() {
        setWake(false);
        PlaybackService.listener = null;
        PlaybackService.hide(getContext());
    }
}
