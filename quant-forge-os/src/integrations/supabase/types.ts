export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      watchlists: {
        Row: {
          id: string
          user_id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          created_at?: string
        }
        Relationships: []
      }
      watchlist_items: {
        Row: {
          id: string
          watchlist_id: string
          user_id: string
          symbol: string
          name: string | null
          created_at: string
        }
        Insert: {
          id?: string
          watchlist_id: string
          user_id: string
          symbol: string
          name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          watchlist_id?: string
          user_id?: string
          symbol?: string
          name?: string | null
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          display_name: string | null
          email: string | null
          timezone: string | null
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id: string
          display_name?: string | null
          email?: string | null
          timezone?: string | null
          avatar_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          display_name?: string | null
          email?: string | null
          timezone?: string | null
          avatar_url?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}