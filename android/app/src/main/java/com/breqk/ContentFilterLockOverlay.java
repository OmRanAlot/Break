package com.Break;
import android.content.Context; import android.graphics.PixelFormat; import android.os.Handler; import android.os.Looper; import android.text.*; import android.util.Log; import android.view.*; import android.view.inputmethod.InputMethodManager; import android.widget.*; import com.Break.reflection.ReflectionRepository;
/** Mandatory reflection gate; only a successful local insert dismisses it. */
public class ContentFilterLockOverlay {
 private static final String TAG="BROWSER_WATCH"; private final Context context; private final Handler main; private final ReflectionRepository repo;
 private View view; private boolean showing,saving; private long firstTyped;
 public ContentFilterLockOverlay(Context c,Handler h){context=c;main=h!=null?h:new Handler(Looper.getMainLooper());repo=new ReflectionRepository(c);}
 public boolean isShowing(){return showing;}
 public void show(String domain,Runnable onSaved){if(showing)return;showing=true;saving=false;firstTyped=0;main.post(()->{
  WindowManager wm=(WindowManager)context.getSystemService(Context.WINDOW_SERVICE);if(wm==null){showing=false;return;}
  view=LayoutInflater.from(context).inflate(R.layout.overlay_content_filter_lock,null); EditText input=view.findViewById(R.id.content_filter_reflection_input); TextView count=view.findViewById(R.id.content_filter_character_count); TextView error=view.findViewById(R.id.content_filter_save_error); ((TextView)view.findViewById(R.id.content_filter_domain)).setText(domain); Button save=view.findViewById(R.id.content_filter_save_btn);save.setEnabled(false);
  input.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int b,int c){} public void afterTextChanged(Editable e){} public void onTextChanged(CharSequence s,int a,int b,int c){if(firstTyped==0)firstTyped=System.currentTimeMillis();int n=s.toString().trim().length();count.setText(n+" / 100");save.setEnabled(!saving&&n>=100);error.setVisibility(View.GONE);}});
  save.setOnClickListener(v->{String message=input.getText().toString().trim();if(saving||message.length()<100)return;saving=true;save.setEnabled(false);save.setText("Saving…");long now=System.currentTimeMillis();repo.insert(message,domain,firstTyped,now,(entry,failure)->main.post(()->{if(failure==null){dismiss();if(onSaved!=null)onSaved.run();}else{saving=false;save.setText("Save reflection");save.setEnabled(input.getText().toString().trim().length()>=100);error.setText("Couldn’t save. Your writing is still here — try again.");error.setVisibility(View.VISIBLE);Log.e(TAG,"[CF_LOCK] save failed",failure);}}));});
  WindowManager.LayoutParams p=new WindowManager.LayoutParams(-1,-1,WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,PixelFormat.OPAQUE);p.gravity=Gravity.CENTER;
  try{wm.addView(view,p);input.requestFocus();input.postDelayed(()->{InputMethodManager im=(InputMethodManager)context.getSystemService(Context.INPUT_METHOD_SERVICE);if(im!=null)im.showSoftInput(input,InputMethodManager.SHOW_IMPLICIT);},200);}catch(Exception e){showing=false;view=null;Log.e(TAG,"[CF_LOCK] show failed",e);}
 });}
 public void dismiss(){if(!showing&&view==null)return;showing=false;saving=false;View old=view;view=null;main.post(()->{WindowManager wm=(WindowManager)context.getSystemService(Context.WINDOW_SERVICE);if(wm!=null&&old!=null)try{wm.removeView(old);}catch(Exception ignored){}});}
}
