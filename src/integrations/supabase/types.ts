export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      artisans: {
        Row: {
          bio: string;
          category: string;
          cert_path: string | null;
          created_at: string;
          id_doc_path: string | null;
          is_online: boolean;
          last_active_at: string | null;
          lat: number | null;
          lng: number | null;
          portfolio: string[];
          rating: number;
          rating_count: number;
          user_id: string;
          verified: boolean;
        };
        Insert: {
          bio?: string;
          category?: string;
          cert_path?: string | null;
          created_at?: string;
          id_doc_path?: string | null;
          is_online?: boolean;
          last_active_at?: string | null;
          lat?: number | null;
          lng?: number | null;
          portfolio?: string[];
          rating?: number;
          rating_count?: number;
          user_id: string;
          verified?: boolean;
        };
        Update: {
          bio?: string;
          category?: string;
          cert_path?: string | null;
          created_at?: string;
          id_doc_path?: string | null;
          is_online?: boolean;
          last_active_at?: string | null;
          lat?: number | null;
          lng?: number | null;
          portfolio?: string[];
          rating?: number;
          rating_count?: number;
          user_id?: string;
          verified?: boolean;
        };
        Relationships: [];
      };
      disputes: {
        Row: {
          created_at: string;
          id: string;
          job_id: string;
          raised_by: string;
          report_type: string;
          reported_user_id: string | null;
          reason: string;
          resolution: string | null;
          status: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          job_id: string;
          raised_by?: string;
          report_type?: string;
          reported_user_id?: string | null;
          reason: string;
          resolution?: string | null;
          status?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          job_id?: string;
          raised_by?: string;
          report_type?: string;
          reported_user_id?: string | null;
          reason?: string;
          resolution?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "disputes_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      jobs: {
        Row: {
          address: string;
          artisan_id: string | null;
          category: string;
          created_at: string;
          customer_id: string;
          customer_confirmed_at: string | null;
          description: string;
          id: string;
          lat: number | null;
          lng: number | null;
          payment_method: string | null;
          payment_status: string;
          photos: string[];
          price_estimate: number;
          rating: number | null;
          quote_required: boolean;
          review: string | null;
          review_public: boolean;
          scheduled_at: string | null;
          status: string;
          urgency: string;
        };
        Insert: {
          address?: string;
          artisan_id?: string | null;
          category: string;
          created_at?: string;
          customer_id?: string;
          customer_confirmed_at?: string | null;
          description: string;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          payment_method?: string | null;
          payment_status?: string;
          photos?: string[];
          price_estimate?: number;
          rating?: number | null;
          quote_required?: boolean;
          review?: string | null;
          review_public?: boolean;
          scheduled_at?: string | null;
          status?: string;
          urgency?: string;
        };
        Update: {
          address?: string;
          artisan_id?: string | null;
          category?: string;
          created_at?: string;
          customer_id?: string;
          customer_confirmed_at?: string | null;
          description?: string;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          payment_method?: string | null;
          payment_status?: string;
          photos?: string[];
          price_estimate?: number;
          rating?: number | null;
          quote_required?: boolean;
          review?: string | null;
          review_public?: boolean;
          scheduled_at?: string | null;
          status?: string;
          urgency?: string;
        };
        Relationships: [];
      };
      job_quotes: {
        Row: {
          change_reason: string | null;
          decided_at: string | null;
          decided_by: string | null;
          decision_approved: boolean | null;
          id: string;
          items: Json;
          job_id: string;
          scope: string;
          status: string;
          submitted_at: string;
          submitted_by: string;
          total: number;
          version: number;
        };
        Insert: {
          change_reason?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_approved?: boolean | null;
          id?: string;
          items: Json;
          job_id: string;
          scope: string;
          status?: string;
          submitted_at?: string;
          submitted_by: string;
          total: number;
          version: number;
        };
        Update: {
          change_reason?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_approved?: boolean | null;
          id?: string;
          items?: Json;
          job_id?: string;
          scope?: string;
          status?: string;
          submitted_at?: string;
          submitted_by?: string;
          total?: number;
          version?: number;
        };
        Relationships: [];
      };
      job_updates: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          id: string;
          job_id: string;
          kind: string;
          media_path: string | null;
        };
        Insert: {
          author_id: string;
          body: string;
          created_at?: string;
          id?: string;
          job_id: string;
          kind: string;
          media_path?: string | null;
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          job_id?: string;
          kind?: string;
          media_path?: string | null;
        };
        Relationships: [];
      };
      job_snags: {
        Row: {
          created_at: string;
          created_by: string;
          description: string;
          id: string;
          job_id: string;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          status: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          description: string;
          id?: string;
          job_id: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          description?: string;
          id?: string;
          job_id?: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          job_id: string;
          sender_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          job_id: string;
          sender_id?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          job_id?: string;
          sender_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      analytics_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          entity_id: string | null;
          event_type: string;
          id: string;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          event_type: string;
          id?: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          event_type?: string;
          id?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          is_read: boolean;
          job_id: string | null;
          title: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          is_read?: boolean;
          job_id?: string | null;
          title: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          is_read?: boolean;
          job_id?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      page_views: {
        Row: {
          created_at: string;
          device: string | null;
          id: string;
          path: string;
          referrer: string | null;
          user_id: string | null;
          visitor_id: string;
        };
        Insert: {
          created_at?: string;
          device?: string | null;
          id?: string;
          path: string;
          referrer?: string | null;
          user_id?: string | null;
          visitor_id: string;
        };
        Update: {
          created_at?: string;
          device?: string | null;
          id?: string;
          path?: string;
          referrer?: string | null;
          user_id?: string | null;
          visitor_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          created_at: string;
          full_name: string;
          id: string;
          phone: string | null;
        };
        Insert: {
          avatar_path?: string | null;
          created_at?: string;
          full_name?: string;
          id: string;
          phone?: string | null;
        };
        Update: {
          avatar_path?: string | null;
          created_at?: string;
          full_name?: string;
          id?: string;
          phone?: string | null;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          commission_pct: number;
          id: number;
        };
        Insert: {
          commission_pct?: number;
          id?: number;
        };
        Update: {
          commission_pct?: number;
          id?: number;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      customer_reviews: {
        Args: never;
        Returns: {
          category: string;
          created_at: string;
          id: string;
          rating: number;
          review: string;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      artisan_completed_job_counts: {
        Args: { _artisan_ids: string[] };
        Returns: { artisan_id: string; completed_jobs: number }[];
      };
      confirm_job_handover: {
        Args: { _job: string };
        Returns: undefined;
      };
      create_job_snag: {
        Args: { _description: string; _job: string };
        Returns: string;
      };
      decide_job_quote: {
        Args: { _approve: boolean; _quote: string };
        Returns: undefined;
      };
      mark_artisan_active: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      reschedule_job: {
        Args: { _job: string; _scheduled_at: string };
        Returns: undefined;
      };
      resolve_job_snag: {
        Args: { _resolution: string; _snag: string };
        Returns: undefined;
      };
      respond_job: {
        Args: { _accept: boolean; _job: string };
        Returns: undefined;
      };
      submit_job_quote: {
        Args: { _change_reason?: string; _items: Json; _job: string; _scope: string };
        Returns: string;
      };
    };
    Enums: {
      app_role: "admin" | "customer" | "artisan";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "customer", "artisan"],
    },
  },
} as const;
