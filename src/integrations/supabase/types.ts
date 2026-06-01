export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          created_at: string
          device_id: string | null
          farm_id: string | null
          house_id: string | null
          id: string
          message: string
          resolved: boolean | null
          severity: string
          type: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          farm_id?: string | null
          house_id?: string | null
          id?: string
          message: string
          resolved?: boolean | null
          severity?: string
          type: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          farm_id?: string | null
          house_id?: string | null
          id?: string
          message?: string
          resolved?: boolean | null
          severity?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "poultry_houses"
            referencedColumns: ["id"]
          },
        ]
      }
      biogas_records: {
        Row: {
          created_at: string
          efficiency_pct: number | null
          farm_id: string
          fertilizer_kg: number | null
          gas_m3: number | null
          id: number
          waste_kg: number | null
        }
        Insert: {
          created_at?: string
          efficiency_pct?: number | null
          farm_id: string
          fertilizer_kg?: number | null
          gas_m3?: number | null
          id?: number
          waste_kg?: number | null
        }
        Update: {
          created_at?: string
          efficiency_pct?: number | null
          farm_id?: string
          fertilizer_kg?: number | null
          gas_m3?: number | null
          id?: number
          waste_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "biogas_records_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
        ]
      }
      cameras: {
        Row: {
          created_at: string
          farm_id: string | null
          house_id: string | null
          id: string
          last_seen: string | null
          name: string
          status: string | null
          stream_url: string | null
        }
        Insert: {
          created_at?: string
          farm_id?: string | null
          house_id?: string | null
          id?: string
          last_seen?: string | null
          name: string
          status?: string | null
          stream_url?: string | null
        }
        Update: {
          created_at?: string
          farm_id?: string | null
          house_id?: string | null
          id?: string
          last_seen?: string | null
          name?: string
          status?: string | null
          stream_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cameras_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cameras_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "poultry_houses"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          api_key: string
          created_at: string
          device_id: string
          farm_id: string | null
          firmware_version: string | null
          house_id: string | null
          id: string
          last_seen: string | null
          location: string | null
          online: boolean | null
          type: string
        }
        Insert: {
          api_key: string
          created_at?: string
          device_id: string
          farm_id?: string | null
          firmware_version?: string | null
          house_id?: string | null
          id?: string
          last_seen?: string | null
          location?: string | null
          online?: boolean | null
          type?: string
        }
        Update: {
          api_key?: string
          created_at?: string
          device_id?: string
          farm_id?: string | null
          firmware_version?: string | null
          house_id?: string | null
          id?: string
          last_seen?: string | null
          location?: string | null
          online?: boolean | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "poultry_houses"
            referencedColumns: ["id"]
          },
        ]
      }
      energy_records: {
        Row: {
          battery_pct: number | null
          consumption_w: number | null
          created_at: string
          farm_id: string
          id: number
          solar_w: number | null
        }
        Insert: {
          battery_pct?: number | null
          consumption_w?: number | null
          created_at?: string
          farm_id: string
          id?: number
          solar_w?: number | null
        }
        Update: {
          battery_pct?: number | null
          consumption_w?: number | null
          created_at?: string
          farm_id?: string
          id?: number
          solar_w?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "energy_records_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
        ]
      }
      farms: {
        Row: {
          created_at: string
          id: string
          location: string | null
          name: string
          owner_id: string | null
          region: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          location?: string | null
          name: string
          owner_id?: string | null
          region?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          location?: string | null
          name?: string
          owner_id?: string | null
          region?: string | null
        }
        Relationships: []
      }
      hatcheries: {
        Row: {
          created_at: string
          egg_count: number | null
          expected_hatch_at: string | null
          farm_id: string
          hatched_count: number | null
          humidity: number | null
          id: string
          name: string
          started_at: string | null
          temperature: number | null
        }
        Insert: {
          created_at?: string
          egg_count?: number | null
          expected_hatch_at?: string | null
          farm_id: string
          hatched_count?: number | null
          humidity?: number | null
          id?: string
          name: string
          started_at?: string | null
          temperature?: number | null
        }
        Update: {
          created_at?: string
          egg_count?: number | null
          expected_hatch_at?: string | null
          farm_id?: string
          hatched_count?: number | null
          humidity?: number | null
          id?: string
          name?: string
          started_at?: string | null
          temperature?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "hatcheries_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
        ]
      }
      poultry_houses: {
        Row: {
          batch_name: string | null
          bird_count: number | null
          capacity: number | null
          created_at: string
          farm_id: string
          id: string
          name: string
        }
        Insert: {
          batch_name?: string | null
          bird_count?: number | null
          capacity?: number | null
          created_at?: string
          farm_id: string
          id?: string
          name: string
        }
        Update: {
          batch_name?: string | null
          bird_count?: number | null
          capacity?: number | null
          created_at?: string
          farm_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "poultry_houses_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
        }
        Relationships: []
      }
      sensor_readings: {
        Row: {
          air_quality: number | null
          created_at: string
          current_a: number | null
          device_id: string
          feed_level: number | null
          house_id: string | null
          humidity: number | null
          id: number
          light: number | null
          payload: Json | null
          temperature: number | null
          water_level: number | null
        }
        Insert: {
          air_quality?: number | null
          created_at?: string
          current_a?: number | null
          device_id: string
          feed_level?: number | null
          house_id?: string | null
          humidity?: number | null
          id?: number
          light?: number | null
          payload?: Json | null
          temperature?: number | null
          water_level?: number | null
        }
        Update: {
          air_quality?: number | null
          created_at?: string
          current_a?: number | null
          device_id?: string
          feed_level?: number | null
          house_id?: string | null
          humidity?: number | null
          id?: number
          light?: number | null
          payload?: Json | null
          temperature?: number | null
          water_level?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sensor_readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sensor_readings_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "poultry_houses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "worker"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "worker"],
    },
  },
} as const
