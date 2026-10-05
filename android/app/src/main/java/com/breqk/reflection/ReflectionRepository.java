package com.Break.reflection;

import android.content.Context;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ReflectionRepository {
    public interface Callback<T> { void complete(T value, Throwable error); }
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private final ReflectionDao dao;
    public ReflectionRepository(Context context) { dao = ReflectionDatabase.get(context).reflections(); }
    public void insert(String message, String domain, long firstTypedAtMs, long savedAtMs, Callback<ReflectionEntry> cb) {
        IO.execute(() -> { try {
            String trimmed = message == null ? "" : message.trim();
            if (trimmed.length() < 100) throw new IllegalArgumentException("Reflection must be at least 100 characters");
            ReflectionEntry e = new ReflectionEntry(UUID.randomUUID().toString(), trimmed, domain,
                    savedAtMs, firstTypedAtMs, Math.max(0, savedAtMs-firstTypedAtMs));
            dao.insert(e); cb.complete(e, null);
        } catch (Throwable t) { cb.complete(null, t); }});
    }
    public void list(String q,int l,int o,Callback<List<ReflectionEntry>> cb){ IO.execute(()->{try{cb.complete(dao.list(q==null?"":q,Math.max(1,Math.min(l,100)),Math.max(0,o)),null);}catch(Throwable t){cb.complete(null,t);}}); }
    public void get(String id,Callback<ReflectionEntry> cb){ IO.execute(()->{try{cb.complete(dao.get(id),null);}catch(Throwable t){cb.complete(null,t);}}); }
    public void delete(String id,Callback<Integer> cb){ IO.execute(()->{try{cb.complete(dao.delete(id),null);}catch(Throwable t){cb.complete(null,t);}}); }
    public void clear(Callback<Boolean> cb){ IO.execute(()->{try{dao.clear();cb.complete(true,null);}catch(Throwable t){cb.complete(false,t);}}); }
}
