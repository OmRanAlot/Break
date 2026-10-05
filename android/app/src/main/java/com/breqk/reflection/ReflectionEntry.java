package com.Break.reflection;

import androidx.annotation.NonNull;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "reflection_entries")
public class ReflectionEntry {
    @PrimaryKey @NonNull public String id;
    @NonNull public String message;
    @NonNull public String domain;
    @ColumnInfo(name = "created_at_ms") public long createdAtMs;
    @ColumnInfo(name = "first_typed_at_ms") public long firstTypedAtMs;
    @ColumnInfo(name = "typing_duration_ms") public long typingDurationMs;

    public ReflectionEntry(@NonNull String id, @NonNull String message, @NonNull String domain,
            long createdAtMs, long firstTypedAtMs, long typingDurationMs) {
        this.id=id; this.message=message; this.domain=domain; this.createdAtMs=createdAtMs;
        this.firstTypedAtMs=firstTypedAtMs; this.typingDurationMs=typingDurationMs;
    }
}
