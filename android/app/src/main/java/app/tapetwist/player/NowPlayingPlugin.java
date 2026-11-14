package app.tapetwist.player;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The page's side of PlaybackService: app/utils/native.ts. */
@CapacitorPlugin(name = "NowPlaying")
public class NowPlayingPlugin extends Plugin {
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

    @Override
    protected void handleOnDestroy() {
        PlaybackService.listener = null;
        PlaybackService.hide(getContext());
    }
}
