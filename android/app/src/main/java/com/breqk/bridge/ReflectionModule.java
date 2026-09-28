package com.Break.bridge;
import androidx.annotation.NonNull; import com.Break.reflection.*; import com.facebook.react.bridge.*; import java.util.List;
public class ReflectionModule extends ReactContextBaseJavaModule {
 private final ReflectionRepository repo; public ReflectionModule(ReactApplicationContext c){super(c);repo=new ReflectionRepository(c);}
 @NonNull public String getName(){return "ReflectionModule";}
 private static WritableMap map(ReflectionEntry e){WritableMap m=Arguments.createMap();m.putString("id",e.id);m.putString("message",e.message);m.putString("domain",e.domain);m.putDouble("createdAtMs",e.createdAtMs);m.putDouble("firstTypedAtMs",e.firstTypedAtMs);m.putDouble("typingDurationMs",e.typingDurationMs);return m;}
 private static void fail(Promise p,Throwable t){p.reject("E_REFLECTION_DB",t.getMessage(),t);}
 @ReactMethod public void getReflections(String query,double limit,double offset,Promise p){repo.list(query,(int)limit,(int)offset,(rows,e)->{if(e!=null){fail(p,e);return;}WritableArray a=Arguments.createArray();for(ReflectionEntry row:rows)a.pushMap(map(row));p.resolve(a);});}
 @ReactMethod public void getReflection(String id,Promise p){repo.get(id,(row,e)->{if(e!=null)fail(p,e);else if(row==null)p.reject("E_NOT_FOUND","Reflection not found");else p.resolve(map(row));});}
 @ReactMethod public void deleteReflection(String id,Promise p){repo.delete(id,(n,e)->{if(e!=null)fail(p,e);else p.resolve(n>0);});}
 @ReactMethod public void clearReflections(Promise p){repo.clear((ok,e)->{if(e!=null)fail(p,e);else p.resolve(ok);});}
}
