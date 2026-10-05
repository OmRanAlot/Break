package com.Break.reflection;

import android.content.Context;
import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

@Database(entities = {ReflectionEntry.class}, version = 1, exportSchema = false)
public abstract class ReflectionDatabase extends RoomDatabase {
    public abstract ReflectionDao reflections();
    private static volatile ReflectionDatabase instance;
    public static ReflectionDatabase get(Context context) {
        if (instance == null) synchronized (ReflectionDatabase.class) {
            if (instance == null) instance = Room.databaseBuilder(context.getApplicationContext(),
                    ReflectionDatabase.class, "reflections.db").build();
        }
        return instance;
    }
}
