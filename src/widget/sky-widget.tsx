import { FlexWidget, SvgWidget, TextWidget } from "react-native-android-widget";
import * as SunCalc from "suncalc";
import type { Coords } from "@/lib/api";
import { directionTo, formatDistance } from "@/lib/geo";

// What the app saves for the widget (the widget can't reach the server itself).
export type WidgetData = { paired: boolean; me: Coords | null; them: Coords | null; secondsTogether: number };

type Body = "sun" | "moon";

const upHere = (where: Coords, now: Date): Body | null =>
    SunCalc.getPosition(now, where.latitude, where.longitude).altitude > 0 ? "sun"
        : SunCalc.getMoonPosition(now, where.latitude, where.longitude).altitude > 0 ? "moon"
            : null;

function skyLine(me: Body | null, them: Body | null) {
    if (me && me === them) return `The ${me} is up for both of you`;
    if (me && them) return `The ${me} is up for you, the ${them} for them`;
    if (me) return `The ${me} is up for you - their sky is quiet`;
    if (them) return `Your sky is quiet - the ${them} is up for them`;
    return "The sky is quiet for you both right now";
}

// 45 s -> "<1 min", 4 min, 1 h 12 min (the widget only updates now and then)
function roughDuration(seconds: number) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours} h ${minutes} min`;
    return minutes > 0 ? `${minutes} min` : "<1 min";
}

const sunSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
<defs><radialGradient id="g"><stop offset="0" stop-color="#FFF4D6"/><stop offset="0.3" stop-color="#FFD27A" stop-opacity="0.9"/><stop offset="1" stop-color="#FFB347" stop-opacity="0"/></radialGradient></defs>
<circle cx="50" cy="50" r="48" fill="url(#g)"/></svg>`;

// tonight's moon, like in the app: half the disc plus or minus half an ellipse
function moonSvg(now: Date) {
    const { fraction, phase } = SunCalc.getMoonIllumination(now);
    const terminator = 22 * Math.abs(1 - 2 * fraction);
    const bulge = fraction < 0.5 ? 0 : 1;
    const turn = phase < 0.5 ? 0 : 180; // waxing: lit on the right
    return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
<defs><radialGradient id="g"><stop offset="0.2" stop-color="#DDE3FF" stop-opacity="0.55"/><stop offset="1" stop-color="#C9D3FF" stop-opacity="0"/></radialGradient></defs>
<circle cx="50" cy="50" r="48" fill="url(#g)" opacity="${0.3 + 0.7 * fraction}"/>
<circle cx="50" cy="50" r="22" fill="#0A0F2C" fill-opacity="0.5"/>
<path d="M50,28 A22,22 0 0,1 50,72 A${terminator},22 0 0,${bulge} 50,28 Z" fill="#F5F3EE" transform="rotate(${turn} 50 50)"/></svg>`;
}

// A plain function, not a component: the widget library calls it outside React, where
// the React Compiler's added hooks would crash.
export function renderSkyWidget(data: WidgetData, now = new Date()) {
    const { paired, me, them, secondsTogether } = data;
    const mine = me && upHere(me, now);
    const theirs = them && upHere(them, now);

    const title = !paired ? "Share the sky with someone special"
        : me && them ? skyLine(mine, theirs)
            : "Open Stellate to see your skies";
    const details = [
        me && them ? `${formatDistance(directionTo(me, them).km)} apart` : null,
        paired && secondsTogether > 0 ? `${roughDuration(secondsTogether)} together` : null,
    ].filter(Boolean).join("  ·  ");

    return (
        <FlexWidget
            clickAction="OPEN_APP"
            style={{
                width: "match_parent", height: "match_parent", flexDirection: "row", alignItems: "center",
                paddingHorizontal: 16, paddingVertical: 12, borderRadius: 24,
                backgroundGradient: { from: "#1B1F4B", to: "#0A0F2C", orientation: "TOP_BOTTOM" },
            }}
        >
            <SvgWidget svg={mine === "sun" ? sunSvg : moonSvg(now)} style={{ width: 64, height: 64 }} />
            <FlexWidget style={{ flex: 1, flexDirection: "column", marginLeft: 12 }}>
                <TextWidget text={title} maxLines={2} style={{ fontSize: 18, fontFamily: "BelgantAesthetic", color: "#EEF0FF" }} />
                {details ? (
                    <FlexWidget style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
                        <TextWidget text="●" style={{ fontSize: 10, color: "#F7B7C8" }} />
                        <TextWidget text={details} maxLines={1} truncate="END" style={{ fontSize: 12, fontFamily: "PublicSans-Regular", color: "#8C93B8", marginLeft: 6 }} />
                    </FlexWidget>
                ) : null}
            </FlexWidget>
        </FlexWidget>
    );
}
