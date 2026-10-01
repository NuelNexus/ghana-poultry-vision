import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bird, Warehouse, Thermometer, Droplets, Sun, BatteryCharging, AlertTriangle,
  TrendingDown, Egg, Activity,
} from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area } from "recharts";
import { getDashboard } from "@/lib/api/farm.functions";
import { AiStatusPanel } from "@/components/ai-status";
import { PageHeader, StatCard, Card, Badge } from "@/components/ui-kit";

export const Route = createFileRoute("/app/")({
  component: Dashboard,
});

function Dashboard() {
  const [isRain] = useState(() => Math.random() < 0.5);
  // Neon has no realtime channel; poll instead (the Pi reports every 30 s).
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => getDashboard(), refetchInterval: 10_000 });
  const stats = data?.stats;
  const recentAlerts = data?.recentAlerts;
  const series = (data?.history ?? []).map((r) => ({
    t: new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    temp: Number(r.temperature) || 0,
    hum: Number(r.humidity) || 0,
  }));
  const worst = (data?.ai ?? []).slice().sort((a, b) => rank(b.ai_status) - rank(a.ai_status))[0];

  return (
    <div>
      <PageHeader title="Dashboard" description="Realtime overview of all your poultry farms." />
      <figure className={`farm-illustration${isRain ? " is-rain" : ""}`} aria-hidden="true">
        <svg className="farm-svg" id="farm-layer" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink"
          width="719" height="222" viewBox="0 0 719 222">
          <g id="sun">
            <circle id="XMLID_275_" className="st0" cx="474.9" cy="31.9" r="23.8" />
            <circle id="XMLID_274_" className="st1" cx="474.9" cy="31.9" r="15.4" />
          </g>
          <g id="cloud-rain2">
            <g id="rain2">
              <path id="XMLID_32_" className="st2" d="M230.5 16.6l-10.4 44.6" />
              <path id="XMLID_15_" className="st2" d="M245.5 16.6l-11.4 43.6" />
              <path id="XMLID_14_" className="st2" d="M260.5 17.6l-7.4 28.6" />
              <path id="XMLID_13_" className="st2" d="M279.5 18.6l-7.4 28.6" />
            </g>
            <path id="cloud2" className="st3" d="M290 19.2c-.5-2.4-1.6-4.7-3.4-6.4-2.3-2.3-5.4-3.6-8.7-3.6-3.2 0-6.3 1.3-8.6 3.5-.5-.8-1.1-1.6-1.8-2.3-2.4-2.4-5.7-3.7-9-3.7-2.2 0-4.3.6-6.1 1.6-.2-.8-.6-1.5-1-2.2-1.6-2.7-4.2-4.8-7.3-5.6-3.1-.9-6.6-.4-9.4 1.2-2.7 1.6-4.8 4.2-5.6 7.3-.1.3-.1.5-.2.8h-.5c-5.3 0-9.6 4.3-9.9 9.5H290z" />
          </g>
          <g id="cloud-rain3">
            <g id="rain3">
              <path id="XMLID_44_" className="st2" d="M359.5 49.6l-14.4 60.6" />
              <path id="XMLID_40_" className="st2" d="M368.5 49.6l-16.4 65.6" />
              <path id="XMLID_39_" className="st2" d="M377.5 51.6l-17.4 71.6" />
              <path id="XMLID_34_" className="st2" d="M385.5 51.6l-14.4 63.6" />
            </g>
            <path id="cloud3" className="st3" d="M388.6 53.6c-.6-2-1.9-3.8-3.8-4.9-.8-.4-1.6-.8-2.5-1-1.4-.3-2.8-.3-4.1.1-.3.1-.7.2-1 .4-.4-1.3-1.1-2.5-2.1-3.4-1.6-1.6-3.7-2.4-5.9-2.4s-4.3.9-5.9 2.4c-.9.9-1.6 2.1-2 3.3-.4-.1-.9-.1-1.4-.1-3.7 0-5.6 2.9-5.6 5.9h34.3v-.3z" />
          </g>
          <g id="cloud-rain4">
            <g id="rain4">
              <path id="XMLID_73_" className="st2" d="M485.5 49.6l-14.4 60.6" />
              <path id="XMLID_69_" className="st2" d="M493.5 50.6l-16.4 65.6" />
              <path id="XMLID_48_" className="st2" d="M500.5 52.6l-17.4 71.6" />
            </g>
            <path id="cloud4" className="st3" d="M504.8 52.2c.3-1.8-.1-3.7-1-5.2-1-1.8-2.7-3.1-4.7-3.6l-2.1-.3h-.7c0-3.5-2.9-6.3-6.3-6.3-3.5 0-6.3 2.9-6.3 6.3 0 .8.1 1.5.4 2.2-1.4 0-2.8.6-3.9 1.7s-1.7 2.5-1.7 4c0 .4.1.8.1 1.2h26.2z" />
          </g>
          <path id="mountains" className="st4" d="M32.1 166.6L147.2 2.1l69.2 76.2 53.6-55 90.4 96.7 64.2-64.2 72.7 60L571.5 8.5l116.4 160.2z" />
          <g id="cloud-rain1">
            <g id="rain1">
              <path id="XMLID_3_" className="st2" d="M143.5 24.6l-7.4 28.6" />
              <path id="XMLID_4_" className="st2" d="M152.5 24.6l-7.4 28.6" />
              <path id="XMLID_7_" className="st2" d="M161.5 25.6l-7.4 28.6" />
              <path id="XMLID_8_" className="st2" d="M169.5 26.6l-7.4 28.6" />
            </g>
            <path id="cloud1" className="st3" d="M173.9 26.6c-.6-2.3-2.6-4.2-5.9-4.2-.7 0-1.6.2-2.3.5-1-1.7-2.6-3-5.2-3-.8 0-1.5.1-2.1.4-.8-2.8-3.4-4.9-6.4-4.9-3.4 0-6.3 2.6-6.6 6h-.3c-2.2 0-4 1.8-4 4 0 .5.1.9.2 1.4h32.6z" />
          </g>
          <g id="hill1">
            <path id="XMLID_298_" className="st5" d="M302.3 170.1c-9.9-71.9-65.1-127-131.7-127s-121.8 55-131.7 127h263.4z" />
            <path id="XMLID_297_" className="st6" d="M168.7 170.1V43.2c-65.7 1-120 55.7-129.8 126.9h129.8z" />
          </g>
          <g id="cloud-rain5">
            <g id="rain5">
              <path id="XMLID_82_" className="st2" d="M564.5 74.6l-10.4 39.6" />
              <path id="XMLID_81_" className="st2" d="M573.5 74.6l-9.4 33.6" />
              <path id="XMLID_77_" className="st2" d="M582.5 75.6l-7.4 28.6" />
              <path id="XMLID_1_" className="st2" d="M590.5 76.6l-7.4 28.6" />
            </g>
            <path id="cloud5" className="st3" d="M597.6 77.2c.5-1.1.8-2.3.8-3.5 0-2.2-.9-4.3-2.4-5.8-.9-.9-1.9-1.5-3.1-1.9v-.1c-.4-1.4-1.1-2.7-2.2-3.7-2.1-2.1-5.3-3-8.2-2.2-2.5.7-4.5 2.5-5.5 4.8-1.4-.9-3-1.4-4.7-1.4-2.2 0-4.4.9-6 2.5-.9.9-1.6 2.1-2 3.3-.3-.1-.5-.2-.8-.3-1.3-.4-2.6-.4-3.9 0-2.5.7-4.5 2.7-5.2 5.2-.3 1.1-.3 2.2-.1 3.2h43.3z" />
          </g>
          <g id="cloud-rain6">
            <g id="rain6">
              <path id="XMLID_97_" className="st2" d="M646.5 62.6l-14.4 60.6" />
              <path id="XMLID_92_" className="st2" d="M654.5 63.6l-16.4 65.6" />
              <path id="XMLID_87_" className="st2" d="M661.5 63.6l-17.4 71.6" />
              <path id="XMLID_102_" className="st2" d="M668.5 63.6l-17.4 71.6" />
              <path id="XMLID_103_" className="st2" d="M639.5 60.6l-17.4 71.6" />
            </g>
            <path id="cloud6" className="st3" d="M672.7 65.3c.9-1.8 1.4-3.8 1.4-5.8 0-3.3-1.3-6.5-3.6-8.8-2.3-2.3-5.5-3.6-8.8-3.6-1 0-2 .1-2.9.4-.5-.6-1.1-1.1-1.7-1.6-2.8-2.3-6.2-3.1-9.5-1.2-2.6 1.5-4.5 5.2-3.8 8.3h-.7c-2.2 0-4.3 1.2-5.4 3.1-.6 1-.9 2-.9 3.2 0 .5.1 1 .2 1.4-.1 0-.2-.1-.3-.1-3.4 0-5.2 2.6-5.5 4.9h41.5z" />
          </g>
          <g id="ground-floor">
            <defs>
              <path id="XMLID_10_" d="M43.3 172.2c-3.2 5-5.1 11-5.1 17.5 0 17.8 14.5 32.3 32.3 32.3h579.2c17.8 0 32.3-14.5 32.3-32.3 0-6.4-1.9-12.4-5.1-17.5H43.3z" />
            </defs>
            <use xlinkHref="#XMLID_10_" overflow="visible" fill="#8F4200" />
            <clipPath id="XMLID_199_">
              <use xlinkHref="#XMLID_10_" overflow="visible" />
            </clipPath>
            <ellipse id="XMLID_313_" className="st7" cx="119.9" cy="208.8" rx="11.4" ry="6.9" />
            <ellipse id="XMLID_312_" className="st7" cx="143.2" cy="203.7" rx="8.2" ry="5" />
            <ellipse id="XMLID_311_" className="st7" cx="321.1" cy="221.5" rx="11.4" ry="6.9" />
            <ellipse id="XMLID_310_" className="st7" cx="343.4" cy="214.3" rx="8.2" ry="5" />
            <ellipse id="XMLID_309_" className="st7" cx="308.1" cy="207.2" rx="5.8" ry="3.5" />
            <ellipse id="XMLID_308_" className="st7" cx="237.5" cy="204.5" rx="11.4" ry="6.9" />
            <ellipse id="XMLID_307_" className="st7" cx="260.8" cy="199.4" rx="8.2" ry="5" />
            <ellipse id="XMLID_306_" className="st7" cx="217.3" cy="192" rx="8.2" ry="5" />
            <ellipse id="XMLID_305_" className="st7" cx="440" cy="201.3" rx="5.3" ry="4.7" />
            <ellipse id="XMLID_304_" className="st7" cx="610.2" cy="207.1" rx="15.6" ry="9.5" />
            <ellipse id="XMLID_303_" className="st7" cx="523.4" cy="191.2" rx="15.6" ry="9.5" />
            <ellipse id="XMLID_302_" className="st7" cx="538.7" cy="205.5" rx="7.7" ry="4.7" />
            <ellipse id="XMLID_301_" className="st7" cx="79.2" cy="188.5" rx="7.7" ry="4.7" />
          </g>
          <g id="hill3">
            <path id="XMLID_295_" className="st8" d="M675.4 168.7c-5.7-41.5-37.6-73.3-76.1-73.3-38.5 0-70.3 31.8-76.1 73.3h152.2z" />
          </g>
          <g id="hill2">
            <path id="XMLID_293_" className="st8" d="M372.6 170.1c-7.1-51.5-46.6-90.9-94.3-90.9-47.7 0-87.2 39.4-94.3 90.9h188.6z" />
            <path id="XMLID_292_" className="st6" d="M276.9 170.1V79.2c-47.1.7-86 39.9-93 90.9h93z" />
          </g>
          <g id="yellow-hill">
            <g id="XMLID_285_">
              <defs>
                <path id="XMLID_9_" d="M272.5 170.1c-7.7-55.7-50.4-98.4-102-98.4s-94.3 42.6-102 98.4h204z" />
              </defs>
              <use xlinkHref="#XMLID_9_" overflow="visible" fill="#FFB300" />
              <clipPath id="XMLID_203_">
                <use xlinkHref="#XMLID_9_" overflow="visible" />
              </clipPath>
              <path id="XMLID_290_" className="st9" d="M161.5 67s81 16.8 99 113.8h-23.3s2.1-66.2-75.7-113.8z" />
              <path id="XMLID_289_" className="st9" d="M122.3 69s81 16.8 99 113.8H198s2.1-66.2-75.7-113.8z" />
              <path id="XMLID_288_" className="st9" d="M77.8 69s81 16.8 99 113.8h-23.3s2.2-66.2-75.7-113.8z" />
              <path id="XMLID_287_" className="st9" d="M32.3 69s81 16.8 99 113.8H108s2.1-66.2-75.7-113.8z" />
            </g>
            <path id="XMLID_284_" className="st10" d="M169.1 170.1V71.8c-50.9.8-93 43.1-100.6 98.3h100.6z" />
          </g>
          <g id="yellow-hill2">
            <g id="XMLID_277_">
              <defs>
                <path id="XMLID_12_" d="M626.2 184.9c-5-36.1-32.7-63.8-66.2-63.8s-61.2 27.7-66.2 63.8h132.4z" />
              </defs>
              <use xlinkHref="#XMLID_12_" overflow="visible" fill="#FFA100" />
              <clipPath id="XMLID_204_">
                <use xlinkHref="#XMLID_12_" overflow="visible" />
              </clipPath>
              <path id="XMLID_282_" className="st11" d="M554.2 117s52.5 13.8 64.2 73.8h-15.1s1.4-42.9-49.1-73.8z" />
              <path id="XMLID_281_" className="st11" d="M528.8 118s52.5 13.8 64.2 73.8h-15.1s1.3-42.9-49.1-73.8z" />
              <path id="XMLID_280_" className="st11" d="M499.9 118s52.5 13.8 64.2 73.8H549s1.4-42.9-49.1-73.8z" />
              <path id="XMLID_279_" className="st11" d="M470.4 118s52.5 13.8 64.2 73.8h-15.1s1.4-42.9-49.1-73.8z" />
            </g>
          </g>
          <g id="windmill">
            <g id="XMLID_266_">
              <defs>
                <path id="XMLID_6_" d="M108 160.8H58v-81l24.4-25.6L108 79.8z" />
              </defs>
              <use xlinkHref="#XMLID_6_" overflow="visible" fill="#FF5343" />
              <clipPath id="XMLID_207_">
                <use xlinkHref="#XMLID_6_" overflow="visible" />
              </clipPath>
              <path id="XMLID_272_" className="st12" d="M45 145.8h75v48H45z" />
              <path id="XMLID_271_" className="st13" d="M55 122.8h10v8H55z" />
              <path id="XMLID_270_" className="st13" d="M95 114.8h10v6H95z" />
              <path id="XMLID_269_" className="st13" d="M55 96.8h10v5H55z" />
              <path id="XMLID_268_" className="st13" d="M102 88.8h10v8h-10z" />
            </g>
            <g id="XMLID_263_">
              <path id="XMLID_265_" className="st14" d="M90.7 161.6v-17.1c0-4.4-3.6-7.9-7.9-7.9-4.4 0-7.9 3.6-7.9 7.9v17.1h15.8z" />
              <path id="XMLID_264_" className="st3" d="M75.8 161.6v-17.1c0-3.8 3.1-6.9 6.9-6.9 3.8 0 6.9 3.1 6.9 6.9v17.1h2v-17.1c0-4.9-4-8.9-8.9-8.9s-8.9 4-8.9 8.9v17.1h2z" />
            </g>
            <circle id="XMLID_262_" className="st15" cx="82.7" cy="114.6" r="7.9" />
            <circle id="XMLID_261_" className="st15" cx="82.7" cy="86.5" r="7.9" />
            <g id="blades">
              <g id="XMLID_256_">
                <path id="XMLID_260_" className="st3" d="M85.9 55.3l-5.2 2.2-21.2-38.7L73 13.1z" />
                <path id="XMLID_259_" className="st3" d="M80.2 53.4l2.2 5.2-38.7 21.3L38 66.4z" />
                <path id="XMLID_258_" className="st3" d="M81.2 58.5l5.2-2.1 21.2 38.7-13.5 5.7z" />
                <path id="XMLID_257_" className="st3" d="M83.5 58.2L81.3 53 120 31.8l5.7 13.5z" />
              </g>
              <circle id="XMLID_255_" className="st16" cx="82.7" cy="55.2" r="4.2" />
            </g>
          </g>
          <g id="house">
            <g id="XMLID_245_">
              <path id="XMLID_247_" className="st16" d="M347.2 161.4V131l-39-17.4.9 47.8z" />
              <path id="XMLID_246_" className="st17" d="M308.2 111.6l43 21.9" />
            </g>
            <g id="XMLID_240_">
              <path id="XMLID_244_" className="st18" d="M312 87.7l-.2-28.9h-18.1z" />
              <path id="XMLID_243_" className="st19" d="M290 60.3h22" />
              <path id="XMLID_242_" className="st18" d="M211.3 87.7l.1-28.9h18.1z" />
              <path id="XMLID_241_" className="st19" d="M235 60.3h-25" />
            </g>
            <g id="XMLID_232_">
              <defs>
                <path id="XMLID_11_" d="M295.2 62.7l-34-23.3-34.6 23.3L210 96.5v64.3h101V96.5z" />
              </defs>
              <use xlinkHref="#XMLID_11_" overflow="visible" className="st20" />
              <clipPath id="XMLID_208_">
                <use xlinkHref="#XMLID_11_" overflow="visible" />
              </clipPath>
            </g>
            <path id="XMLID_231_" className="st21" d="M204.5 103l22.7-40.3 34.2-23.3 34.1 23.3 23.2 40.8" />
            <g id="XMLID_225_">
              <path id="XMLID_230_" className="st3" d="M235 109.8h55v51h-55z" />
              <path id="XMLID_229_" className="st14" d="M240 114.8h43v41h-43z" />
              <path id="XMLID_228_" className="st3" d="M260 112.8h5v44h-5z" />
              <path id="XMLID_227_" className="st22" d="M239 129l46.1-.2" />
              <path id="XMLID_226_" className="st22" d="M239 143.8l46.1-.2" />
            </g>
            <path id="XMLID_224_" className="st23" d="M254 75.8h16v15h-16z" />
            <g id="XMLID_221_">
              <path id="XMLID_223_" className="st3" d="M320.9 140.8h15.9v20.6h-15.9z" />
              <path id="XMLID_222_" className="st14" d="M323.8 144.2h10.1V158h-10.1z" />
            </g>
            <path id="XMLID_220_" className="st24" d="M252.8 84.5l17.8-.2" />
          </g>
          <g id="tractor-group">
            <g id="tractor">
              <path id="XMLID_218_" className="st25" d="M133.5 135.8v-13.7l-2.9-3.8" />
              <path id="XMLID_217_" className="st26" d="M171.5 135.4c-1.3 0-2.6-1.2-2.9-2.6l-3.4-14.8h-21.4l-3.7 14.2c-.4 1.4-1.9 2.6-3.4 2.6l-10.8.3c-4 0-5.5 2.3-5.5 5.9v11c0 1.5 1.2 2.7 2.7 2.7h40.8c1.5 0 3.8-.4 5.2-.8l2.2-.7c1.4-.4 2.5-2 2.5-3.5v-11.6c0-1.5-1-2.7-2.3-2.7z" />
              <g id="XMLID_212_">
                <g id="XMLID_214_">
                  <path id="XMLID_158_" className="st27" d="M156.4 156.1l-1.4.7c-.7-1.5-1.1-3.2-1.1-4.9h1.6c0-1.6.4-3.2 1.1-4.5l-1.4-.7c.8-1.5 1.9-2.8 3.2-3.9l1 1.2c1.2-1 2.6-1.7 4.2-2l-.3-1.5c1.6-.3 3.4-.3 5 .1l-.4 1.5c1.6.4 3 1.1 4.2 2.1l1-1.2c1.3 1.1 2.4 2.4 3.1 4l-1.4.7c.6 1.3 1 2.8 1 4.4v.2h1.6c0 1.7-.4 3.4-1.2 4.9l-1.4-.7c-.7 1.4-1.7 2.7-2.9 3.6l1 1.2c-1.4 1-2.9 1.8-4.5 2.1l-.3-1.5c-.7.2-1.5.3-2.2.3-.8 0-1.6-.1-2.4-.3l-.4 1.5c-1.7-.4-3.2-1.2-4.5-2.2l1-1.2c-1.5-1.2-2.5-2.5-3.2-3.9z" />
                </g>
                <circle id="XMLID_213_" className="st3" cx="165.6" cy="151.7" r="3.9" />
              </g>
              <g id="XMLID_209_">
                <path id="XMLID_38_" className="st28" d="M146.6 143.8H145l2.6-21.3h13.2l2.9 12c-6.9.2-14.3 3.2-17.1 9.3z" />
              </g>
              <g id="XMLID_206_">
                <path id="XMLID_36_" className="st27" d="M161.1 134.7c-6.1.8-12.1 3.8-14.5 9.1H145l1.1-9.1h15z" />
              </g>
              <path id="XMLID_205_" className="st14" d="M154.8 134.8v-3.6c0-1.8 1.5-3.3 3.3-3.3 1.8 0 3.3 1.5 3.3 3.3v3.6h-6.6z" />
              <g id="XMLID_200_">
                <g id="XMLID_202_">
                  <path id="XMLID_168_" className="st27" d="M131.5 159.5c-1.5 1.5-3.5 2.3-5.4 2.5l.1 1.2c-1.9.2-3.8-.2-5.5-1.1l.5-1c-.8-.4-1.6-1-2.2-1.6-.8-.8-1.5-1.8-1.9-2.8l-1.1.5c-.8-1.8-1-3.7-.7-5.6l1.2.2c.3-1.8 1.1-3.5 2.5-4.9l.4-.4-.8-.9c1.4-1.3 3.2-2.1 5.1-2.4l.2 1.2c2-.3 4.1.1 5.9 1.1l.6-1c.7.4 1.4 1 2 1.5.8.8 1.4 1.6 1.9 2.6l-1.1.5c1 1.9 1.2 4 .7 6l1.2.3c-.4 1.9-1.3 3.6-2.7 5l-.1.1-.8-1z" />
                </g>
                <circle id="XMLID_201_" className="st3" cx="125.1" cy="153" r="3" />
              </g>
            </g>
            <path id="tractor-black-thing" className="st27" d="M136 129.3c0 1.4-1.1 2.5-2.5 2.5s-2.5-1.1-2.5-2.5v-3c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5v3z" />
          </g>
          <g id="floor">
            <path id="XMLID_196_" className="st29" d="M719 176.6c0 8.1-6.6 14.3-14.7 14.3H14.7c-8.1 0-14.7-6.1-14.7-14.3v-.2c0-8.1 6.6-15.5 14.7-15.5h689.6c8.1 0 14.7 7.4 14.7 15.5v.2z" />
            <path id="XMLID_195_" className="st29" d="M719 176.6c0 8.1-6.6 14.3-14.7 14.3H14.7c-8.1 0-14.7-6.1-14.7-14.3v-.2c0-8.1 6.6-15.5 14.7-15.5h689.6c8.1 0 14.7 7.4 14.7 15.5v.2z" />
            <path id="XMLID_194_" className="st8" d="M704.3 178.8H14.7c-5.9 0-11-3.5-13.3-8.5-.9 1.9-1.4 3.8-1.4 6 0 8.1 6.6 14.5 14.7 14.5h689.6c8.1 0 14.7-6.4 14.7-14.5 0-2.2-.5-4.2-1.4-6.1-2.3 5-7.4 8.6-13.3 8.6z" />
          </g>
          <g id="flowers-field">
            <path id="ground" className="st14" d="M602 168.8c0 4.4-3.6 8-8 8H374c-4.4 0-8-3.6-8-8s3.6-8 8-8h220c4.4 0 8 3.6 8 8z" />
            <g id="flowers">
              <g id="XMLID_181_">
                <g id="XMLID_189_">
                  <path id="XMLID_26_" className="st30" d="M379.8 169.2l.5-3.5c.3-2.1.6-4.8.7-7.5v-2c0-.7-.1-1.3-.2-2-.1-.6-.2-1.3-.3-1.8-.1-.6-.2-1.1-.3-1.6-.1-.5-.3-1-.4-1.4-.1-.4-.2-.8-.3-1.1l-.3-.9s.2.3.6.8l.6.9c.2.4.5.8.7 1.3.2.5.5 1 .8 1.6.2.6.5 1.2.8 1.8.3.6.5 1.3.7 2l.6 2.1c.7 2.8 1.2 5.8 1.4 7.9.3 2.1.4 3.5.4 3.5l-6-.1z" />
                </g>
                <g id="XMLID_187_">
                  <path id="XMLID_188_" className="st3" d="M381.7 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.3 3.3 11.1-6 4.9-9.3z" />
                </g>
                <g id="XMLID_185_">
                  <path id="XMLID_186_" className="st3" d="M388 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.3 3.3 11.2-6 4.9-9.3z" />
                </g>
                <g id="XMLID_183_">
                  <path id="XMLID_184_" className="st3" d="M384.8 142.9c-6.2-3.3-11.1 6.1-4.9 9.3 6.3 3.3 11.2-6 4.9-9.3z" />
                </g>
                <path id="XMLID_182_" className="st30" d="M383.6 165.2s3.4-10.7 14.8-6.1c0 0-2.4 11.6-14.8 6.1z" />
              </g>
              <g id="XMLID_170_">
                <g id="XMLID_178_">
                  <path id="XMLID_24_" className="st30" d="M407.3 169.2l.5-3.5c.3-2.1.6-4.8.7-7.5v-2c0-.7-.1-1.3-.2-2-.1-.6-.2-1.3-.3-1.8-.1-.6-.2-1.1-.3-1.6-.1-.5-.3-1-.4-1.4-.1-.4-.2-.8-.3-1.1l-.3-.9s.2.3.6.8l.6.9c.2.4.5.8.7 1.3.2.5.5 1 .8 1.6.2.6.5 1.2.8 1.8.3.6.5 1.3.7 2l.6 2.1c.7 2.8 1.2 5.8 1.4 7.9.3 2.1.4 3.5.4 3.5l-6-.1z" />
                </g>
                <g id="XMLID_176_">
                  <path id="XMLID_177_" className="st3" d="M409.2 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.3 3.3 11.1-6 4.9-9.3z" />
                </g>
                <g id="XMLID_174_">
                  <path id="XMLID_175_" className="st3" d="M415.6 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.2 3.3 11.1-6 4.9-9.3z" />
                </g>
                <g id="XMLID_172_">
                  <path id="XMLID_173_" className="st3" d="M412.4 142.9c-6.2-3.3-11.1 6.1-4.9 9.3 6.3 3.3 11.1-6 4.9-9.3z" />
                </g>
                <path id="XMLID_171_" className="st30" d="M411.1 165.2s3.4-10.7 14.8-6.1c0 0-2.4 11.6-14.8 6.1z" />
              </g>
              <g id="XMLID_159_">
                <g id="XMLID_167_">
                  <path id="XMLID_22_" className="st30" d="M434.8 169.2l.5-3.5c.3-2.1.6-4.8.7-7.5v-2c0-.7-.1-1.3-.2-2-.1-.6-.2-1.3-.3-1.8-.1-.6-.2-1.1-.3-1.6-.1-.5-.3-1-.4-1.4-.1-.4-.2-.8-.3-1.1l-.3-.9s.2.3.6.8l.6.9c.2.4.5.8.7 1.3.2.5.5 1 .8 1.6.2.6.5 1.2.8 1.8.3.6.5 1.3.7 2l.6 2.1c.7 2.8 1.2 5.8 1.4 7.9.3 2.1.4 3.5.4 3.5l-6-.1z" />
                </g>
                <g id="XMLID_165_">
                  <path id="XMLID_166_" className="st3" d="M436.7 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.3 3.3 11.2-6 4.9-9.3z" />
                </g>
                <g id="XMLID_163_">
                  <path id="XMLID_164_" className="st3" d="M443.1 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.3 3.3 11.1-6 4.9-9.3z" />
                </g>
                <g id="XMLID_161_">
                  <path id="XMLID_162_" className="st3" d="M439.9 142.9c-6.2-3.3-11.1 6.1-4.9 9.3 6.3 3.3 11.2-6 4.9-9.3z" />
                </g>
                <path id="XMLID_160_" className="st30" d="M438.7 165.2s3.4-10.7 14.8-6.1c0 0-2.4 11.6-14.8 6.1z" />
              </g>
              <g id="XMLID_148_">
                <g id="XMLID_156_">
                  <path id="XMLID_20_" className="st30" d="M462.3 169.2l.5-3.5c.3-2.1.6-4.8.7-7.5v-2c0-.7-.1-1.3-.2-2-.1-.6-.2-1.3-.3-1.8-.1-.6-.2-1.1-.3-1.6-.1-.5-.3-1-.4-1.4-.1-.4-.2-.8-.3-1.1l-.3-.9s.2.3.6.8l.6.9c.2.4.5.8.7 1.3.2.5.5 1 .8 1.6.2.6.5 1.2.8 1.8.3.6.5 1.3.7 2l.6 2.1c.7 2.8 1.2 5.8 1.4 7.9.3 2.1.4 3.5.4 3.5l-6-.1z" />
                </g>
                <g id="XMLID_154_">
                  <path id="XMLID_155_" className="st3" d="M464.3 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.2 3.3 11.1-6 4.9-9.3z" />
                </g>
                <g id="XMLID_152_">
                  <path id="XMLID_153_" className="st3" d="M470.6 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.3 3.3 11.2-6 4.9-9.3z" />
                </g>
                <g id="XMLID_150_">
                  <path id="XMLID_151_" className="st3" d="M467.4 142.9c-6.2-3.3-11.1 6.1-4.9 9.3 6.3 3.3 11.2-6 4.9-9.3z" />
                </g>
                <path id="XMLID_149_" className="st30" d="M466.2 165.2s3.4-10.7 14.8-6.1c0 0-2.4 11.6-14.8 6.1z" />
              </g>
              <g id="XMLID_137_">
                <g id="XMLID_145_">
                  <path id="XMLID_18_" className="st30" d="M489.9 169.2l.5-3.5c.3-2.1.6-4.8.7-7.5v-2c0-.7-.1-1.3-.2-2-.1-.6-.2-1.3-.3-1.8-.1-.6-.2-1.1-.3-1.6-.1-.5-.3-1-.4-1.4-.1-.4-.2-.8-.3-1.1l-.3-.9s.2.3.6.8l.6.9c.2.4.5.8.7 1.3.2.5.5 1 .8 1.6.2.6.5 1.2.8 1.8.3.6.5 1.3.7 2l.6 2.1c.7 2.8 1.2 5.8 1.4 7.9.3 2.1.4 3.5.4 3.5l-6-.1z" />
                </g>
                <g id="XMLID_143_">
                  <path id="XMLID_144_" className="st3" d="M491.8 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.3 3.3 11.1-6 4.9-9.3z" />
                </g>
                <g id="XMLID_141_">
                  <path id="XMLID_142_" className="st3" d="M498.1 148.2c-6.3-3.3-11.1 6-4.9 9.3 6.3 3.3 11.2-6 4.9-9.3z" />
                </g>
                <g id="XMLID_139_">
                  <path id="XMLID_140_" className="st3" d="M495 142.9c-6.2-3.3-11.1 6.1-4.9 9.3 6.3 3.3 11.1-6 4.9-9.3z" />
                </g>
                <path id="XMLID_138_" className="st30" d="M493.7 165.2s3.4-10.7 14.8-6.1c0 0-2.4 11.6-14.8 6.1z" />
              </g>
              <g id="XMLID_126_">
                <g id="XMLID_134_">
                  <path id="XMLID_113_" className="st30" d="M517.4 169.2l.5-3.5c.3-2.1.6-4.8.7-7.5v-2c0-.7-.1-1.3-.2-2-.1-.6-.2-1.3-.3-1.8-.1-.6-.2-1.1-.3-1.6-.1-.5-.3-1-.4-1.4-.1-.4-.2-.8-.3-1.1l-.3-.9s.2.3.6.8l.6.9c.2.4.5.8.7 1.3.2.5.5 1 .8 1.6.2.6.5 1.2.8 1.8.3.6.5 1.3.7 2l.6 2.1c.7 2.8 1.2 5.8 1.4 7.9.3 2.1.4 3.5.4 3.5l-6-.1z" />
                </g>
                <g id="XMLID_132_">
                  <path id="XMLID_133_" className="st3" d="M519.3 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.3 3.3 11.2-6 4.9-9.3z" />
                </g>
                <g id="XMLID_130_">
                  <path id="XMLID_131_" className="st3" d="M525.7 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.3 3.3 11.1-6 4.9-9.3z" />
                </g>
                <g id="XMLID_128_">
                  <path id="XMLID_129_" className="st3" d="M522.5 142.9c-6.2-3.3-11.1 6.1-4.9 9.3 6.3 3.3 11.2-6 4.9-9.3z" />
                </g>
                <path id="XMLID_127_" className="st30" d="M521.3 165.2s3.4-10.7 14.8-6.1c0 0-2.4 11.6-14.8 6.1z" />
              </g>
              <g id="XMLID_115_">
                <g id="XMLID_123_">
                  <path id="XMLID_124_" className="st30" d="M544.9 169.2l.5-3.5c.3-2.1.6-4.8.7-7.5v-2c0-.7-.1-1.3-.2-2-.1-.6-.2-1.3-.3-1.8-.1-.6-.2-1.1-.3-1.6-.1-.5-.3-1-.4-1.4-.1-.4-.2-.8-.3-1.1l-.3-.9s.2.3.6.8l.6.9c.2.4.5.8.7 1.3.2.5.5 1 .8 1.6.2.6.5 1.2.8 1.8.3.6.5 1.3.7 2l.6 2.1c.7 2.8 1.2 5.8 1.4 7.9.3 2.1.4 3.5.4 3.5l-6-.1z" />
                </g>
                <g id="XMLID_121_">
                  <path id="XMLID_122_" className="st3" d="M546.9 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.2 3.3 11.1-6 4.9-9.3z" />
                </g>
                <g id="XMLID_119_">
                  <path id="XMLID_120_" className="st3" d="M553.2 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.3 3.3 11.2-6 4.9-9.3z" />
                </g>
                <g id="XMLID_117_">
                  <path id="XMLID_118_" className="st3" d="M550 142.9c-6.2-3.3-11.1 6.1-4.9 9.3 6.3 3.3 11.2-6 4.9-9.3z" />
                </g>
                <path id="XMLID_116_" className="st30" d="M548.8 165.2s3.4-10.7 14.8-6.1c0 0-2.4 11.6-14.8 6.1z" />
              </g>
              <g id="XMLID_104_">
                <g id="XMLID_112_">
                  <path id="XMLID_135_" className="st30" d="M572.5 169.2l.5-3.5c.3-2.1.6-4.8.7-7.5v-2c0-.7-.1-1.3-.2-2-.1-.6-.2-1.3-.3-1.8-.1-.6-.2-1.1-.3-1.6-.1-.5-.3-1-.4-1.4-.1-.4-.2-.8-.3-1.1l-.3-.9s.2.3.6.8l.6.9c.2.4.5.8.7 1.3.2.5.5 1 .8 1.6.2.6.5 1.2.8 1.8.3.6.5 1.3.7 2l.6 2.1c.7 2.8 1.2 5.8 1.4 7.9.3 2.1.4 3.5.4 3.5l-6-.1z" />
                </g>
                <g id="XMLID_110_">
                  <path id="XMLID_111_" className="st3" d="M574.4 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.3 3.3 11.1-6 4.9-9.3z" />
                </g>
                <g id="XMLID_108_">
                  <path id="XMLID_109_" className="st3" d="M580.7 148.2c-6.2-3.3-11.1 6-4.9 9.3 6.3 3.3 11.2-6 4.9-9.3z" />
                </g>
                <g id="XMLID_106_">
                  <path id="XMLID_107_" className="st3" d="M577.6 142.9c-6.2-3.3-11.1 6.1-4.9 9.3 6.3 3.3 11.1-6 4.9-9.3z" />
                </g>
                <path id="XMLID_105_" className="st30" d="M576.3 165.2s3.4-10.7 14.8-6.1c0 0-2.4 11.6-14.8 6.1z" />
              </g>
            </g>
          </g>
          <g id="bag2">
            <path id="XMLID_101_" className="st14" d="M212.1 158.5l-.6-8.5c0-3.5-2.7-6.4-6.2-6.4s-6.3 2.8-6.3 6.4l-.7 8.5c-.7 0-1.3.6-1.3 1.3v.5c0 .7.6.5 1.3.5h14.3c.7 0 .4.2.4-.5v-.5c0-.7-.1-1.3-.9-1.3z" />
            <path id="XMLID_100_" className="st18" d="M202 152.8h6v2h-6z" />
            <path id="XMLID_99_" className="st14" d="M208.3 140.5c0-1.1-.9-2.1-2.1-2.1-.9 0-1.6.5-1.9 1.3-1.1-.9-2.9.4-2.3 1.9.3.8 1.1 1 1.7.8.1.2.1.3.2.5-.1.1-.1.3-.2.4-.3.6-.2 1.1-.2 1.8.1 1.2.4 2.7 2 2.7 1.5 0 1.9-1.6 1.6-2.8.1-.8-.2-1.7-.6-2.4 1-.3 1.8-1.1 1.8-2.1z" />
            <path id="XMLID_98_" className="st3" d="M207 143.3c0 .3-.2.5-.5.5h-3c-.3 0-.5-.2-.5-.5s.2-.5.5-.5h3c.3 0 .5.3.5.5z" />
          </g>
          <g id="bag1">
            <path id="XMLID_96_" className="st14" d="M61.4 158.5l-.9-8.5c0-3.5-2.9-6.4-6.4-6.4-3.5 0-6.4 2.8-6.4 6.4l-1.1 8.5c-.7 0-1.6.6-1.6 1.3v.5c0 .7 1.1.5 1.9.5h14.3c.7 0 1.8.2 1.8-.5v-.5c0-.7-.9-1.3-1.6-1.3z" />
            <path id="XMLID_95_" className="st18" d="M50 152.8h8v2h-8z" />
            <path id="XMLID_94_" className="st14" d="M56.8 140.5c0-1.1-.9-2.1-2.1-2.1-.9 0-1.6.5-1.9 1.3-1.1-.9-2.9.4-2.3 1.9.3.8 1.1 1 1.7.8.1.2.1.3.2.5-.1.1-.1.3-.2.4-.3.6-.2 1.1-.2 1.8.1 1.2.4 2.7 2 2.7 1.5 0 1.9-1.6 1.6-2.8.1-.8-.2-1.7-.6-2.4 1.1-.3 1.8-1.1 1.8-2.1z" />
            <path id="XMLID_93_" className="st3" d="M55 143.3c0 .3-.2.5-.5.5h-3c-.3 0-.5-.2-.5-.5s.2-.5.5-.5h3c.3 0 .5.3.5.5z" />
          </g>
          <g id="bag3">
            <path id="XMLID_91_" className="st14" d="M360.2 158.5l-1-8.5c0-3.5-3-6.4-6.5-6.4s-6.4 2.8-6.4 6.4l-.9 8.5c-.7 0-1.4.6-1.4 1.3v.5c0 .7.7.5 1.5.5h14.3c.7 0 2.2.2 2.2-.5v-.5c0-.7-1-1.3-1.8-1.3z" />
            <path id="XMLID_90_" className="st18" d="M349 152.8h6v2h-6z" />
            <path id="XMLID_89_" className="st14" d="M355.4 140.5c0-1.1-.9-2.1-2.1-2.1-.9 0-1.6.5-1.9 1.3-1.1-.9-2.9.4-2.3 1.9.3.8 1.1 1 1.8.8.1.2.1.3.2.5-.1.1-.1.3-.2.4-.3.6-.2 1.1-.2 1.8.1 1.2.4 2.7 2 2.7 1.5 0 1.9-1.6 1.6-2.8.1-.8-.2-1.7-.6-2.4 1-.3 1.7-1.1 1.7-2.1z" />
            <path id="XMLID_88_" className="st3" d="M354 143.3c0 .3-.2.5-.5.5h-3c-.3 0-.5-.2-.5-.5s.2-.5.5-.5h3c.3 0 .5.3.5.5z" />
          </g>
          <g id="bucket">
            <path id="XMLID_86_" className="st31" d="M192.5 154.4c0 1.6-1.3 2.9-2.9 2.9h-.2c-1.6 0-2.9-1.3-2.9-2.9v-4.2c0-1.6 1.3-2.9 2.9-2.9h.2c1.6 0 2.9 1.3 2.9 2.9v4.2z" />
            <path id="XMLID_85_" className="st26" d="M193.6 160.8h-8.2l-1.1-9h10.5z" />
            <path id="XMLID_84_" className="st32" d="M194 160.3c0 .3-.2.5-.5.5h-8c-.3 0-.5-.2-.5-.5s.2-.5.5-.5h8c.3 0 .5.2.5.5z" />
            <path id="XMLID_83_" className="st32" d="M195 152.3c0 .3-.2.5-.5.5h-10c-.3 0-.5-.2-.5-.5s.2-.5.5-.5h10c.3 0 .5.2.5.5z" />
          </g>
          <g id="trees">
            <g id="tree1">
              <path id="XMLID_80_" className="st1" d="M624 136c0 9.5-7.7 16.9-17.2 16.9h-.5c-9.5 0-17.3-7.4-17.3-16.9v-24.8c0-9.5 7.8-16.3 17.3-16.3h.5c9.5 0 17.2 6.8 17.2 16.3V136z" />
              <path id="XMLID_79_" className="st33" d="M606.2 93.8c-9.4.1-17.1 7.8-17.1 17.2v25.1c0 9.5 7.6 17.1 17.1 17.2V93.8z" />
              <path id="XMLID_78_" className="st34" d="M609.6 162.4v-32.7c0-1.8-1.5-3.3-3.3-3.3-1.8 0-3.3 1.5-3.3 3.3v32.7h6.6z" />
            </g>
            <g id="tree2">
              <path id="XMLID_76_" className="st1" d="M656 137.6c0 9.5-7.7 17.2-17.2 17.2h-.5c-9.5 0-17.2-7.7-17.2-17.2v-25.5c0-9.5 7.7-17.2 17.2-17.2h.5c9.5 0 17.2 7.7 17.2 17.2v25.5z" />
              <path id="XMLID_75_" className="st33" d="M637.8 93.8c-9.4.1-17.1 7.8-17.1 17.2v25.1c0 9.5 7.6 17.1 17.1 17.2V93.8z" />
              <path id="XMLID_74_" className="st34" d="M641.3 162.4v-32.7c0-1.8-1.5-3.3-3.3-3.3-1.8 0-3.3 1.5-3.3 3.3v32.7h6.6z" />
            </g>
            <g id="tree3">
              <path id="XMLID_72_" className="st1" d="M688 137.6c0 9.5-7.7 17.2-17.2 17.2h-.5c-9.5 0-17.2-7.7-17.2-17.2v-25.5c0-9.5 7.7-17.2 17.2-17.2h.5c9.5 0 17.2 7.7 17.2 17.2v25.5z" />
              <path id="XMLID_71_" className="st33" d="M669.5 93.8c-9.4.1-17.1 7.8-17.1 17.2v25.1c0 9.5 7.6 17.1 17.1 17.2V93.8z" />
              <path id="XMLID_70_" className="st34" d="M672.9 162.4v-32.7c0-1.8-1.5-3.3-3.3-3.3-1.8 0-3.3 1.5-3.3 3.3v32.7h6.6z" />
            </g>
            <g id="oranges">
              <g id="XMLID_67_">
                <circle id="XMLID_68_" className="st35" cx="597.1" cy="109.2" r="3.2" />
              </g>
              <g id="XMLID_65_">
                <circle id="XMLID_66_" className="st35" cx="614" cy="115.6" r="3.2" />
              </g>
              <g id="XMLID_63_">
                <circle id="XMLID_64_" className="st35" cx="597.1" cy="138.9" r="3.2" />
              </g>
              <g id="XMLID_61_">
                <circle id="XMLID_62_" className="st35" cx="627.8" cy="131.5" r="3.2" />
              </g>
              <g id="XMLID_59_">
                <circle id="XMLID_60_" className="st35" cx="632" cy="110.3" r="3.2" />
              </g>
              <g id="XMLID_57_">
                <circle id="XMLID_58_" className="st35" cx="646.8" cy="120.9" r="3.2" />
              </g>
              <g id="XMLID_55_">
                <circle id="XMLID_56_" className="st35" cx="660.6" cy="112.4" r="3.2" />
              </g>
              <g id="XMLID_53_">
                <circle id="XMLID_54_" className="st35" cx="677.5" cy="108.2" r="3.2" />
              </g>
              <g id="XMLID_51_">
                <circle id="XMLID_52_" className="st35" cx="681.8" cy="134.6" r="3.2" />
              </g>
              <g id="XMLID_49_">
                <circle id="XMLID_50_" className="st35" cx="659.5" cy="134.6" r="3.2" />
              </g>
            </g>
          </g>
          <g id="flag">
            <path id="XMLID_46_" className="st34" d="M553.8 99.6h3.2v26h-3.2z" />
            <path id="XMLID_45_" className="st16" d="M557 109.8l-23.3-7.4 23.3-7.5z" />
          </g>
          <g id="butterfly1">
            <path id="XMLID_43_" className="st16 wing-down" d="M413.4 128c-.2-.5-.6-1-1.1-1.3-.8-.5-1.6-.6-2.4-.6-1.6.1-2.9 1.8-3 3.3-.1 1.1.4 2.2 1.3 2.9.5.3 1 .5 1.6.6.6.1 1.4-.1 1.9-.4.1.3.2.5.3.8 0 .2.1.4.2.6 0 .1.1.1.1.2-.1-.4-.1-.4.1.2.1.4.4.7.7.9.6.4 1.2.4 1.8.2.6-.2 1-.8 1.2-1.4.2-.6.2-1.2.2-1.8 0-.3-.1-.6-.1-.9-.1-1.1-.6-1.8-1.6-2.2-.3-.1-.6-.2-.9-.1-.1-.4-.2-.7-.3-1z" />
            <path id="XMLID_42_" className="st16 wing-up" d="M414.1 127.1c-.6-.1-1.1-.3-1.6-.6-.8-.5-1.1-1.3-1.3-2.1-.4-1.6.7-3.3 2.1-3.9 1-.5 2.3-.3 3.2.3.5.3.8.8 1.1 1.3.3.6.4 1.3.2 2h1.7.2c.4 0 .8.1 1.1.4.6.4.7 1 .8 1.7 0 .7-.5 1.2-1 1.6-.5.4-1 .6-1.7.8-.3.1-.6.1-.9.2-1 .2-1.9 0-2.6-.8-.2-.2-.4-.5-.4-.8-.3-.1-.6-.1-.9-.1z" />
            <path id="XMLID_41_" className="st3" d="M417.3 128.8c.5.3.6 1 .2 1.4-.3.5-1 .6-1.4.2l-5.2-3.7c-.5-.3-.6-1-.2-1.4.3-.5 1-.6 1.4-.2l5.2 3.7z" />
          </g>
          <g id="butterfly3">
            <path id="XMLID_37_" className="st16 wing-up" d="M480.9 126c.6.1 1.1.1 1.7-.1.9-.3 1.4-.9 1.9-1.7.8-1.4.2-3.4-1-4.4-.9-.7-2.1-.9-3.1-.6-.5.2-1 .5-1.4 1-.4.5-.7 1.2-.8 1.8-.3-.1-.6-.1-.8-.2-.2-.1-.4-.1-.6-.2-.1 0-.1 0-.2-.1.4.1.4.1-.2-.1-.4-.1-.8-.1-1.2.1-.7.3-1 .7-1.2 1.4-.2.6.1 1.3.5 1.8s.8.8 1.4 1.2c.2.2.5.3.8.4 1 .5 1.8.5 2.7-.1.3-.2.5-.4.6-.6.3.3.6.4.9.4z" />
            <path id="XMLID_35_" className="st16 wing-down" d="M481.3 127.1c.4-.5.8-.8 1.4-1 .9-.3 1.7-.2 2.5.1 1.5.6 2.3 2.5 2 4-.2 1.1-1 2.1-2.1 2.4-.5.2-1.1.2-1.7.1-.6-.1-1.3-.4-1.8-.9-.2.2-.3.5-.5.7-.1.2-.2.3-.3.5 0 .1-.1.1-.1.2.3-.4.2-.3-.1.2-.2.3-.6.6-.9.7-.7.2-1.2.1-1.8-.3-.6-.4-.8-1.1-.8-1.7 0-.7.1-1.2.3-1.8.1-.3.2-.5.3-.8.4-1 1.1-1.5 2.2-1.7.3 0 .6 0 .9.1.1-.3.3-.6.5-.8z" />
            <path id="XMLID_33_" className="st3" d="M478.1 128.8c-.5.2-1.1-.1-1.3-.6-.2-.5.1-1.1.6-1.3l6-2.2c.5-.2 1.1.1 1.3.6.2.5-.1 1.1-.6 1.3l-6 2.2z" />
          </g>
          <g id="butterfly2">
            <path id="XMLID_5_" className="st35 wing-up" d="M444.9 109.1c.6.1 1.2.1 1.7-.1.9-.3 1.4-.9 1.9-1.7.8-1.4.2-3.4-1-4.4-.9-.7-2.1-.9-3.1-.6-.5.2-1 .5-1.4 1-.4.5-.7 1.2-.8 1.8-.3-.1-.6-.1-.8-.2-.2-.1-.4-.1-.6-.2-.1 0-.1 0-.2-.1.4.1.4.1-.2-.1-.4-.1-.8-.1-1.2.1-.7.3-1 .7-1.2 1.4-.2.6.1 1.3.5 1.8s.8.8 1.4 1.2c.2.2.5.3.8.4 1 .5 1.8.5 2.7-.1.3-.2.5-.4.6-.6.3.2.6.3.9.4z" />
            <path id="XMLID_16_" className="st35 wing-down" d="M445.3 110.2c.4-.5.8-.8 1.4-1 .9-.3 1.7-.2 2.5.1 1.5.6 2.3 2.5 2 4-.2 1.1-1 2.1-2.1 2.4-.5.2-1.1.2-1.7.1-.6-.1-1.3-.4-1.8-.9-.2.2-.3.5-.5.7-.1.2-.2.3-.3.5 0 .1-.1.1-.1.2.3-.4.2-.3-.1.2-.2.3-.6.6-.9.7-.7.2-1.2.1-1.8-.3-.6-.4-.8-1.1-.8-1.7 0-.7.1-1.2.3-1.8.1-.3.2-.5.3-.8.4-1 1.1-1.5 2.2-1.7.3 0 .6 0 .9.1.1-.3.3-.6.5-.8z" />
            <path id="XMLID_47_" className="st3" d="M442.1 111.8c-.5.2-1.1-.1-1.3-.6-.2-.5.1-1.1.6-1.3l6-2.2c.5-.2 1.1.1 1.3.6.2.5-.1 1.1-.6 1.3l-6 2.2z" />
          </g>
        </svg>
      </figure>
      {worst ? (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium">Edge AI · live coop condition</h2>
            <Link to="/app/health" className="text-xs underline">Details</Link>
          </div>
          <AiStatusPanel r={worst} />
        </div>
      ) : (
        <Card title="Edge AI" className="mb-6">
          <p className="text-sm text-muted-foreground">
            No Raspberry Pi has reported yet. Register one under <Link to="/app/devices" className="underline">Devices</Link> and
            start the agent; its live status will appear here.
          </p>
        </Card>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total birds" value={(stats?.totalBirds ?? 0).toLocaleString()} icon={Bird} />
        <StatCard label="Active farms" value={stats?.activeFarms ?? 0} icon={Warehouse} />
        <StatCard label="Temperature" value={stats?.temperature ?? 0} unit="°C" icon={Thermometer} tone="warning" />
        <StatCard label="Humidity" value={stats?.humidity ?? 0} unit="%" icon={Droplets} />
        <StatCard label="Solar power" value={stats?.solar ?? 0} unit="W" icon={Sun} tone="warning" />
        <StatCard label="Battery" value={stats?.battery ?? 0} unit="%" icon={BatteryCharging} tone="success" />
        <StatCard label="Active alerts" value={stats?.activeAlerts ?? 0} icon={AlertTriangle} tone="destructive" />
        <StatCard label="Hatch success" value={stats?.hatchRate ?? 0} unit="%" icon={Egg} tone="success" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-6">
        <Card title="Temperature trend (last 24)" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--color-primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--color-primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6 }} />
                <Area type="monotone" dataKey="temp" stroke="var(--color-primary)" fill="url(#g1)" name="°C" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Mortality (30d)">
          <div className="flex flex-col items-center justify-center h-64">
            <TrendingDown className="h-10 w-10 text-success" />
            <div className="text-4xl font-semibold mt-3">{stats?.mortalityRate ?? 0}%</div>
            <div className="text-sm text-muted-foreground mt-1">Below industry avg</div>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-6">
        <Card title="Humidity trend" className="lg:col-span-2">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6 }} />
                <Line type="monotone" dataKey="hum" stroke="var(--color-primary)" strokeWidth={2} dot={false} name="%" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Recent alerts" action={<Activity className="h-4 w-4 text-muted-foreground" />}>
          {recentAlerts && recentAlerts.length > 0 ? (
            <ul className="space-y-3">
              {recentAlerts.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{a.message}</div>
                    <div className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</div>
                  </div>
                  <Badge tone={a.severity === "critical" ? "destructive" : a.severity === "warning" ? "warning" : "default"}>
                    {a.severity}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No recent alerts.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function rank(s: string | null) {
  return s === "critical" ? 2 : s === "warning" ? 1 : 0;
}
