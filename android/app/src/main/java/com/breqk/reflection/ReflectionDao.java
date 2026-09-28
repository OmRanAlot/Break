package com.Break.reflection;

import androidx.room.Dao;
import androidx.room.Delete;
import androidx.room.Insert;
import androidx.room.Query;
import java.util.List;

@Dao
public interface ReflectionDao {
    @Insert void insert(ReflectionEntry entry);
    @Query("SELECT * FROM reflection_entries WHERE (:query = '' OR message LIKE '%' || :query || '%' COLLATE NOCASE OR domain LIKE '%' || :query || '%' COLLATE NOCASE) ORDER BY created_at_ms DESC, id DESC LIMIT :limit OFFSET :offset")
    List<ReflectionEntry> list(String query, int limit, int offset);
    @Query("SELECT * FROM reflection_entries WHERE id = :id LIMIT 1") ReflectionEntry get(String id);
    @Query("DELETE FROM reflection_entries WHERE id = :id") int delete(String id);
    @Query("DELETE FROM reflection_entries") void clear();
}
