-- Shiro's loading screen.
--
-- This file is placed by Shiro at <datadir>/LuaIntro/addons/main.lua. It is not
-- part of any archive and it does not modify one: Zero-K's own
-- luaintro/main.lua sets `VFS.DEF_MODE = VFS.RAW_FIRST`, so the raw data
-- directory is searched before the game archive and this is found first. The
-- game's checksum is untouched, which is the whole point - a modified archive
-- would desync from the server.
--
-- It replaces Zero-K's addon of the same name rather than drawing beside it, so
-- the progress bar below is ours and has to work. Deleting this file restores
-- the original, which is the uninstall.
--
-- Nothing here loads an external file. The only font is the engine's own, and
-- every shape is a primitive, so there is no path that can fail to resolve and
-- leave somebody staring at a black screen before a match.

if addon.InGetInfo then
	return {
		name    = "Main",
		desc    = "Shiro's loading screen",
		author  = "Shiro",
		license = "GPL2",
		layer   = 0,
		depend  = {"LoadProgress"},
		enabled = true,
	}
end

--------------------------------------------------------------------------------

local lastLoadMessage = ""
local lastProgress = {0, 0}

-- The engine's progress reporting is coarse and stops for long stretches, so
-- Zero-K brackets each phase between a floor and a ceiling and lets the bar
-- move within it. Same table, same reason: without it the bar sits still
-- through pathing and looks hung.
local progressByLastLine = {
	["Parsing Map Information"]     = {0.00, 0.20},
	["Loading Weapon Definitions"]  = {0.10, 0.50},
	["Loading LuaRules"]            = {0.40, 0.80},
	["Loading LuaUI"]               = {0.70, 0.95},
	["Loading Skirmish AIs"]        = {0.90, 0.99},
}

function addon.LoadProgress(message, replaceLastLine)
	lastLoadMessage = message or ""
	if lastLoadMessage:find("Path") then
		-- Pathing emits no fixed message, so it gets its own band.
		lastProgress = {0.30, 0.60}
	end
	lastProgress = progressByLastLine[lastLoadMessage] or lastProgress
end

--------------------------------------------------------------------------------

local font = gl.LoadFont("FreeSansBold.otf", 64, 12, 1.5)

-- Ink on a dimmed map rather than a solid fill: the map is worth seeing, and
-- covering it entirely would be a downgrade dressed up as branding.
local SCRIM = 0.55

local function progress()
	local p = SG.GetLoadProgress()
	if p == 0 then
		return lastProgress[1]
	end
	return math.min(math.max(p, lastProgress[1]), lastProgress[2])
end

function addon.DrawLoadScreen()
	local loaded = progress()
	local vsx, vsy = gl.GetViewSizes()

	gl.Color(0.04, 0.04, 0.05, SCRIM)
	gl.Rect(0, 0, 1, 1)

	-- The bar, in normalised coordinates: a hairline track with a filled run.
	local x1, x2, y, h = 0.20, 0.80, 0.146, 0.0055
	gl.Color(1, 1, 1, 0.16)
	gl.Rect(x1, y, x2, y + h)
	gl.Color(0.93, 0.93, 0.92, 0.95)
	gl.Rect(x1, y, x1 + (x2 - x1) * math.max(0, math.min(1, loaded)), y + h)

	-- Text is drawn in pixels, so the scale changes here and is put back after.
	gl.PushMatrix()
	gl.Scale(1 / vsx, 1 / vsy, 1)

	gl.Color(1, 1, 1, 1)
	font:Print("SHIRO", vsx * 0.5, vsy * 0.60, vsy * 0.075, "oc")

	gl.Color(0.82, 0.82, 0.80, 1)
	font:Print(Game.gameName or "", vsx * 0.5, vsy * 0.545, vsy * 0.024, "oc")

	gl.Color(0.72, 0.72, 0.70, 1)
	font:Print(lastLoadMessage, vsx * 0.5, vsy * 0.175, vsy * 0.020, "oc")

	gl.Color(0.55, 0.55, 0.54, 1)
	if loaded > 0 then
		font:Print(("%.0f%%"):format(loaded * 100), vsx * 0.5, vsy * 0.118, vsy * 0.018, "oc")
	else
		font:Print("Loading", vsx * 0.5, vsy * 0.118, vsy * 0.018, "oc")
	end

	gl.PopMatrix()
	gl.Color(1, 1, 1, 1)
end

function addon.Shutdown()
	if font then
		gl.DeleteFont(font)
		font = nil
	end
end
