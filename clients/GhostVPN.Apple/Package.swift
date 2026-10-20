// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "GhostVPN",
    platforms: [
        .macOS(.v13),
        .iOS(.v16),
    ],
    products: [
        .executable(name: "GhostVPN", targets: ["GhostVPNApp"]),
        .library(name: "GhostVPNKit", targets: ["GhostVPNKit"]),
    ],
    targets: [
        .target(name: "GhostVPNKit"),
        .executableTarget(
            name: "GhostVPNApp",
            dependencies: ["GhostVPNKit"]
        ),
    ]
)
